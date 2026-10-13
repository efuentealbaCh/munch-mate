import {
  type AgentPrinter,
  type AgentPrinterSettings,
  type PrintAgentsSummary,
  type PrintAgentView,
  type PrinterKind,
  type PrintJobView,
  PRINT_LIMITS,
  type RestaurantRole,
} from "@app/types";
import type { AutoPrintMode } from "./print";

/**
 * Print agent (phase 8) on the web: the owner's «Impresoras» screen and what the board does with the
 * restaurant's printers. Pure helpers, tested in printers.test.ts.
 */

/** Who sees the failed print jobs and may retry them (the api answers 403 to anyone else). */
export function canSeePrintJobs(roles: readonly RestaurantRole[]): boolean {
  return roles.includes("owner") || roles.includes("cashier");
}

export const PRINTER_KIND_LABELS: Record<PrinterKind, string> = { usb: "USB", network: "Red" };

/**
 * "hace un momento", "hace 5 min", "hace 3 h", "hace 2 días".
 * @param now Current time in ms (0 = unknown: the label is omitted).
 * @returns null when the moment is unknown.
 */
export function relativeTime(iso: string | null, now: number): string | null {
  if (!iso || !now) return null;
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < 1) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

/** What the owner reads next to a paired computer: "En línea", "Desconectado · hace 5 min", "Nunca se conectó". */
export function agentStatusLabel(agent: Pick<PrintAgentView, "online" | "lastSeenAt">, now: number): string {
  if (agent.online) return "En línea";
  if (!agent.lastSeenAt) return "Desconectado · nunca se conectó";
  const ago = relativeTime(agent.lastSeenAt, now);
  return ago ? `Desconectado · ${ago}` : "Desconectado";
}

/**
 * The categories a printer prints: "Todas" ([]), "Bebidas", "Bebidas y Postres", "3 categorías". Ids of
 * categories deleted since are ignored; a filter left with none of them prints nothing ("Ninguna").
 */
export function categoriesLabel(categoryIds: readonly string[], categories: ReadonlyArray<{ id: string; name: string }>): string {
  if (categoryIds.length === 0) return "Todas";
  const names = categories.filter((c) => categoryIds.includes(c.id)).map((c) => c.name);
  if (names.length === 0) return "Ninguna";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  return `${names.length} categorías`;
}

/**
 * The selection to save from the categories picker: ids of existing categories only, in menu order; every
 * category ticked is the same as no filter (a category created later is then printed too).
 */
export function categoriesToSave(selected: ReadonlySet<string>, categories: ReadonlyArray<{ id: string }>): string[] {
  const ids = categories.filter((c) => selected.has(c.id)).map((c) => c.id);
  return ids.length === categories.length ? [] : ids;
}

/** Copies of each kitchen ticket: an integer within PRINT_LIMITS (anything else → null). */
export function parseCopies(value: string | number): number | null {
  const copies = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(copies) || copies < PRINT_LIMITS.copiesMin || copies > PRINT_LIMITS.copiesMax) return null;
  return copies;
}

/** Copy choices for the select (1…3). */
export const COPIES_CHOICES: readonly number[] = Array.from(
  { length: PRINT_LIMITS.copiesMax - PRINT_LIMITS.copiesMin + 1 },
  (_, index) => PRINT_LIMITS.copiesMin + index,
);

/**
 * Applies an optimistic change to one printer of an agent.
 * @returns The agent with the printer changed (the same object when the printer is not there).
 */
export function patchPrinter(agent: PrintAgentView, key: string, patch: Partial<AgentPrinterSettings>): PrintAgentView {
  if (!agent.printers.some((p) => p.key === key)) return agent;
  return { ...agent, printers: agent.printers.map((p) => (p.key === key ? { ...p, ...patch } : p)) };
}

/**
 * Replaces one printer with the server's copy, keeping the other printers as they are on screen (another
 * change may be in flight on them: the server's copy of those could undo it for a moment).
 * Missing from the server's answer (removed meanwhile) → removed here too.
 */
export function mergePrinter(local: PrintAgentView, server: PrintAgentView, key: string): PrintAgentView {
  const fresh = server.printers.find((p) => p.key === key);
  const printers: AgentPrinter[] = fresh
    ? local.printers.map((p) => (p.key === key ? fresh : p))
    : local.printers.filter((p) => p.key !== key);
  return { ...server, printers };
}

/** The fields of `patch` as they were before it (to roll an optimistic change back). */
export function previousValues(printer: AgentPrinter, patch: Partial<AgentPrinterSettings>): Partial<AgentPrinterSettings> {
  const previous: Partial<AgentPrinterSettings> = {};
  for (const field of Object.keys(patch) as (keyof AgentPrinterSettings)[]) {
    (previous as Record<string, unknown>)[field] = printer[field];
  }
  return previous;
}

// ── Pairing code ────────────────────────────────────────────────────────────

export interface PairingCountdown {
  secondsLeft: number;
  /** "9:42". */
  label: string;
  expired: boolean;
}

/**
 * Time left of a pairing code.
 * @param now Current time in ms; 0 (unknown, before the first tick) shows the code's full lifetime.
 */
export function pairingCountdown(expiresAt: string, now: number): PairingCountdown {
  const left = now ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000)) : PRINT_LIMITS.pairingCodeMinutes * 60;
  const seconds = Number.isFinite(left) ? left : 0;
  return {
    secondsLeft: seconds,
    label: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    expired: seconds === 0,
  };
}

/** Agents that were not in `before` (the computer that just redeemed the code). */
export function newAgents(before: readonly PrintAgentView[], after: readonly PrintAgentView[]): PrintAgentView[] {
  const known = new Set(before.map((a) => a.id));
  return after.filter((a) => !known.has(a.id));
}

// ── The board ───────────────────────────────────────────────────────────────

/**
 * Where the «Comanda» button prints: on the print agent when the restaurant has one that may take it, else
 * through this browser. `summary` null (not loaded, or failed) = browser, as before the print agent.
 * The agent is tried whenever a paired printer is active (`autoKitchen`, `receipts` or an agent online): the
 * api answers how many printers took it, and 0 falls back to the browser, so guessing wrong costs one request.
 */
export function kitchenPrintTarget(summary: PrintAgentsSummary | null, forceBrowser = false): "agent" | "browser" {
  if (forceBrowser || !summary) return "browser";
  return summary.autoKitchen || summary.receipts || summary.online ? "agent" : "browser";
}

/** "Enviada a 1 impresora" / "Enviada a 2 impresoras". */
export function queuedMessage(queued: number): string {
  return `Comanda enviada a ${queued} ${queued === 1 ? "impresora" : "impresoras"}`;
}

export interface PrintBanners {
  /** "Las comandas salen por la impresora de cocina". */
  agentPrints: boolean;
  /** The kitchen printer's computer is offline: tickets wait (role=alert). */
  offline: boolean;
  /** This browser also prints by itself: offer to turn it off so tickets do not come out twice. */
  duplicateBrowser: boolean;
}

/** Which notices the board shows about the print agent, from the summary and this device's settings. */
export function printBanners(summary: PrintAgentsSummary | null, browserAuto: AutoPrintMode): PrintBanners {
  const agentPrints = summary?.autoKitchen ?? false;
  return {
    agentPrints,
    offline: agentPrints && (summary?.offline ?? false),
    duplicateBrowser: agentPrints && browserAuto !== "off",
  };
}

/** Toast of `print.job-failed`: "No se pudo imprimir «Comanda #12» en «EPSON»: sin papel". */
export function jobFailedMessage(job: Pick<PrintJobView, "label" | "printerName" | "agentName" | "error" | "status">): string {
  const where = job.printerName || job.agentName;
  const reason = job.error ?? (job.status === "expired" ? "venció antes de imprimirse" : null);
  return `No se pudo imprimir «${job.label}»${where ? ` en «${where}»` : ""}${reason ? `: ${reason}` : ""}`;
}
