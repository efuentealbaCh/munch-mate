/**
 * Direct ESC/POS printing through a local print agent (phase 8).
 *
 * The agent is a self-contained program on a computer of the restaurant (usually the kitchen PC). It is
 * paired once with a one-time code, keeps a device token, connects to the api over Socket.IO (namespace
 * `PRINT_AGENT_NAMESPACE`) and prints the jobs it receives on USB printers (Windows queue, RAW) or network
 * printers (TCP 9100). The api decides what to print and composes every row (`PrintLine`); the agent only
 * turns rows into ESC/POS bytes, so the ticket design lives in one place (`@app/utils` tickets).
 */

/** Receipt paper widths: 58 mm (32 columns) and 80 mm (48 columns), see `ticketColumns` in @app/utils. */
export const PRINT_PAPERS = ["58", "80"] as const;
export type PrintPaper = (typeof PRINT_PAPERS)[number];

/** How a printer reaches the agent: a Windows print queue (USB, RAW) or a raw TCP socket (port 9100). */
export const PRINTER_KINDS = ["usb", "network"] as const;
export type PrinterKind = (typeof PRINTER_KINDS)[number];

/**
 * Whether a printer prints kitchen tickets and when: never ("off", e.g. a cashier printer for receipts only),
 * when an order arrives ("new") or when the staff accept it ("accepted"). The board's manual "Comanda" goes
 * to the printers that print kitchen tickets (any rule but "off").
 */
export const KITCHEN_PRINT_RULES = ["off", "new", "accepted"] as const;
export type KitchenPrintRule = (typeof KITCHEN_PRINT_RULES)[number];

export const KITCHEN_PRINT_RULE_LABELS: Record<KitchenPrintRule, string> = {
  off: "No imprime comandas",
  new: "Cada pedido nuevo",
  accepted: "Cada pedido al aceptarlo",
};

export const PRINT_LIMITS = {
  /** Agents paired per restaurant (revoked ones do not count). */
  agentsPerRestaurant: 10,
  /** Printers one agent may report. */
  printersPerAgent: 20,
  agentNameMax: 40,
  printerKeyMax: 200,
  printerNameMax: 100,
  appVersionMax: 40,
  /** Categories one printer may filter by. */
  categoriesPerPrinter: 100,
  copiesMin: 1,
  copiesMax: 3,
  /** Pairing codes: length, lifetime. */
  pairingCodeLength: 8,
  pairingCodeMinutes: 10,
  /** A kitchen (or test) ticket not printed after this long is dropped: the kitchen must not get old orders. */
  kitchenExpireMinutes: 30,
  /** A payment receipt not printed after this long is dropped. */
  receiptExpireHours: 24,
  /** Print jobs are deleted after this many days (TTL index). */
  jobsKeepDays: 7,
  /** Failed jobs listed per request (`GET .../print-agents/jobs`). */
  jobsListMax: 50,
  /** Jobs re-sent to an agent when it (re)connects, oldest first. */
  resendMax: 50,
  /** Characters of an error message the agent reports (longer ones are cut). */
  errorMax: 300,
} as const;

// ── Printers and agents ─────────────────────────────────────────────────────

/** What the agent reports about a printer it can reach. `key` is stable across restarts of the agent. */
export interface ReportedPrinter {
  /**
   * Stable id chosen by the agent: "usb:<Windows queue name>" or "net:<ip>:<port>" (e.g. "usb:EPSON TM-T20",
   * "net:192.168.1.50:9100"). The owner's settings are kept per key.
   */
  key: string;
  /** Name shown to the owner (queue name, or the name the user gave the network printer in the agent). */
  name: string;
  kind: PrinterKind;
}

/** The settings the owner edits on the web (body of `PATCH .../printers/:printerKey`, every field optional). */
export interface AgentPrinterSettings {
  /** Printers reported for the first time start disabled: the owner turns them on. */
  enabled: boolean;
  paper: PrintPaper;
  kitchen: KitchenPrintRule;
  /** Menu categories whose items this printer prints on kitchen tickets ([] = every category). */
  categoryIds: string[];
  /** Prints a payment receipt for every payment (table account payments and orders paid on their own). */
  receipts: boolean;
  /** Copies of each kitchen ticket (receipts and tests print once). */
  copies: number;
}

/**
 * A printer of an agent: what the agent reports plus the owner's settings. Printers the agent stops reporting
 * (unplugged, switched off when it started) are kept with their settings and `reported: false`; they get no
 * jobs until the agent reports the same key again. The owner removes the ones that no longer exist.
 */
export interface AgentPrinter extends ReportedPrinter, AgentPrinterSettings {
  /** It came in the agent's last `agent.hello`. Only enabled and reported printers get jobs. */
  reported: boolean;
}

/** Defaults of a printer reported for the first time. */
export const DEFAULT_PRINTER_SETTINGS: AgentPrinterSettings = {
  enabled: false,
  paper: "80",
  kitchen: "off",
  categoryIds: [],
  receipts: false,
  copies: 1,
};

/** A paired agent as the owner sees it. */
export interface PrintAgentView {
  id: string;
  name: string;
  appVersion: string;
  /** Connected right now (to any api replica). */
  online: boolean;
  createdAt: string;
  /** Last connection or heartbeat (updated at most once a minute), null before the first connection. */
  lastSeenAt: string | null;
  printers: AgentPrinter[];
}

/** `GET /api/restaurants/:id/print-agents` (owner). */
export interface PrintAgentsList {
  agents: PrintAgentView[];
  /** Where to download the agent (`PRINT_AGENT_DOWNLOAD_URL`), or null when the server does not offer it. */
  downloadUrl: string | null;
}

/**
 * `GET /api/restaurants/:id/print-agents/summary` (any member of the board): whether tickets come out of an
 * agent, so the browser does not print them a second time.
 */
export interface PrintAgentsSummary {
  /**
   * Some enabled and reported printer of a paired agent prints kitchen tickets (rule other than "off"), even
   * if its agent is offline for a moment (the jobs wait in the queue).
   */
  autoKitchen: boolean;
  /** Some enabled and reported printer prints payment receipts. */
  receipts: boolean;
  /** One of the agents with such a printer (kitchen or receipts) is connected right now. */
  online: boolean;
  /**
   * There are kitchen printers (`autoKitchen`) but none of their agents is connected: the web warns
   * "La impresora de cocina está desconectada".
   */
  offline: boolean;
}

// ── Pairing ─────────────────────────────────────────────────────────────────

/** `POST /api/restaurants/:id/print-agents/pairing-code` (owner): a one-time code typed into the agent. */
export interface PairingCodeView {
  /** `PRINT_LIMITS.pairingCodeLength` characters of `PAIRING_CODE_ALPHABET` (@app/utils), e.g. "K7MX3QPA". */
  code: string;
  expiresAt: string;
}

/** Body of `POST /api/print-agents/pair` (public, sent by the agent). */
export interface PairPrintAgentInput {
  /** Case, spaces and dashes are ignored ("k7mx-3qpa" works). */
  code: string;
  /** Name of this computer as the owner will see it ("Cocina"), ≤ `PRINT_LIMITS.agentNameMax`. */
  name: string;
  appVersion: string;
}

/**
 * Response of the pairing. `token` is the agent's device credential: it is returned only here, the api keeps
 * just its SHA-256, and the agent must store it on its computer (never in logs) and send it as
 * `handshake.auth.token` when connecting.
 */
export interface PairPrintAgentResult {
  agentId: string;
  token: string;
  restaurantName: string;
}

// ── Print jobs ──────────────────────────────────────────────────────────────

/** Kitchen ticket, kitchen ticket of an edited order ("MODIFICADO"), payment receipt, test page. */
export const PRINT_JOB_KINDS = ["kitchen", "kitchen_edited", "receipt", "test"] as const;
export type PrintJobKind = (typeof PRINT_JOB_KINDS)[number];

export const PRINT_JOB_STATUSES = ["queued", "sent", "printed", "failed", "expired"] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

/**
 * One printed row, already composed for the paper's columns: the agent converts it to ESC/POS as is and
 * never wraps or pads text by itself.
 * - `text`: at most `columns / size` characters (Unicode, NFC). Rows with an amount on the right are already
 *   padded with spaces to the full width. Encode it in the printer's code page (CP858/PC850 covers Spanish:
 *   á é í ó ú ñ ü ¿ ¡ ·) and print `?` for anything outside it.
 * - `align`: ESC a 0/1/2.
 * - `bold`: ESC E 1 / ESC E 0.
 * - `size`: 1 = normal, 2 = double width and height (GS ! 0x11).
 * An empty `text` is a blank row (one line feed).
 */
export interface PrintLine {
  text: string;
  align: "left" | "center" | "right";
  bold: boolean;
  size: 1 | 2;
}

/** A ticket laid out for one paper: the rows, then (when `cut`) feed a few lines and cut the paper (GS V 66 n). */
export interface PrintLayout {
  columns: number;
  lines: PrintLine[];
  cut: boolean;
}

/**
 * `print.job` (server → agent). The agent may get the same job twice (it is re-sent after a reconnection
 * while not confirmed), so it must remember the `jobId`s it already printed and answer `print.result` ok
 * again without printing them twice.
 */
export interface PrintJobPayload {
  jobId: string;
  printerKey: string;
  paper: PrintPaper;
  /** Print the layout this many times (each copy cut). */
  copies: number;
  kind: PrintJobKind;
  layout: PrintLayout;
  /** When the job was queued (ISO): an agent may skip kitchen tickets far older than `kitchenExpireMinutes`. */
  queuedAt: string;
}

/** A print job as the staff see it (failed list, retries). */
export interface PrintJobView {
  id: string;
  agentId: string;
  agentName: string;
  printerKey: string;
  /** The printer's name when the job was listed ("" if the agent no longer reports it). */
  printerName: string;
  kind: PrintJobKind;
  /** What it is: "Comanda #12", "Comprobante Mesa 4", "Página de prueba". */
  label: string;
  orderId: string | null;
  status: PrintJobStatus;
  attempts: number;
  /** Last error reported by the agent (failed) or the reason it expired. */
  error: string | null;
  createdAt: string;
  printedAt: string | null;
}

/** `POST /api/restaurants/:id/orders/:orderId/print`: kitchen tickets queued (0 = no kitchen printer active). */
export interface PrintOrderResult {
  queued: number;
}

// ── Agent connection (Socket.IO namespace) ──────────────────────────────────

/** Namespace the agent connects to, on the api origin: `io("https://<domain>/print-agents", { auth: { token } })`. */
export const PRINT_AGENT_NAMESPACE = "/print-agents";

/** Error message of `connect_error` when the token is missing, unknown or revoked: pair again. */
export const PRINT_AGENT_UNAUTHORIZED = "unauthorized";

export const PRINT_AGENT_EVENTS = {
  /** agent → server, first thing after connecting (and whenever its printers change). Ack: `AgentHelloResult`. */
  hello: "agent.hello",
  /** server → agent: the owner changed the agent's name or printer settings. Payload: `AgentConfigPayload`. */
  config: "agent.config",
  /** server → agent: the owner unpaired it; the server disconnects it right after. Forget the token. */
  revoked: "agent.revoked",
  /** server → agent: print this. Payload: `PrintJobPayload`. */
  job: "print.job",
  /** agent → server: how a job went. Payload: `PrintResultInput`; ack: `AgentAck`. */
  result: "print.result",
} as const;

/** `agent.hello` payload: the printers this agent can reach right now (replaces the previous list). */
export interface AgentHelloInput {
  appVersion: string;
  printers: ReportedPrinter[];
}

/** Ack of `agent.hello`. */
export type AgentHelloResult =
  | { ok: true; agentId: string; agentName: string; restaurantName: string; printers: AgentPrinter[] }
  | { ok: false; code: string };

/** `agent.config` payload. */
export interface AgentConfigPayload {
  agentName: string;
  printers: AgentPrinter[];
}

/** `print.result` payload. `error` (ok false) is shown to the owner: write it in plain words. */
export interface PrintResultInput {
  jobId: string;
  ok: boolean;
  error?: string;
}

/** Generic ack of agent events. Codes: INVALID_PAYLOAD, JOB_NOT_FOUND, AGENT_REVOKED. */
export type AgentAck = { ok: true } | { ok: false; code: string };

/** Events the server emits on the agent namespace. */
export interface PrintAgentServerToClientEvents {
  "agent.config": (payload: AgentConfigPayload) => void;
  "agent.revoked": () => void;
  "print.job": (job: PrintJobPayload) => void;
}

/** Events the agent emits (with acks). */
export interface PrintAgentClientToServerEvents {
  "agent.hello": (input: AgentHelloInput, ack: (result: AgentHelloResult) => void) => void;
  "print.result": (input: PrintResultInput, ack: (result: AgentAck) => void) => void;
}
