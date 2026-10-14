import {
  type AgentConfigPayload,
  type AgentHelloResult,
  type AgentPrinter,
  PRINT_AGENT_EVENTS,
  PRINT_AGENT_NAMESPACE,
  PRINT_AGENT_UNAUTHORIZED,
  type PrintAgentClientToServerEvents,
  type PrintAgentServerToClientEvents,
  type PrintResultInput,
  type ReportedPrinter,
} from "@app/types";
import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";
import { JobProcessor, type PrinterLookup } from "./jobs";
import type { Logger } from "./logger";

export type AgentSocket = Socket<PrintAgentServerToClientEvents, PrintAgentClientToServerEvents>;

/** Why the agent must stop and be paired again. */
export type RevokedReason = "revoked" | "unauthorized";

export interface AgentClientOptions {
  /** Origin of the api ("https://dominio"). */
  serverUrl: string;
  token: string;
  appVersion: string;
  printers: PrinterLookup & { reported(): ReportedPrinter[] };
  logger: Logger;
  /** The server revoked this agent or no longer accepts its token: forget the token and stop. Called once. */
  onRevoked: (reason: RevokedReason) => void;
  /** Runs before every periodic rescan (e.g. read the network printers from config.json again). */
  beforeRescan?: () => Promise<void>;
  /** Replaces socket.io-client's `io` (tests). */
  ioFactory?: (url: string, options: Partial<ManagerOptions & SocketOptions>) => AgentSocket;
  /** Printers rescanned this often (ms). */
  rescanMs?: number;
  /** Wait for each `print.result` ack this long before sending it again (ms). */
  ackTimeoutMs?: number;
  /** Wait for the `agent.hello` ack this long (ms). */
  helloTimeoutMs?: number;
  /** `connect_error` "unauthorized" in a row before giving up (a revoked token, not a hiccup). */
  unauthorizedLimit?: number;
  reconnectDelayMs?: number;
  reconnectDelayMaxMs?: number;
}

/**
 * The agent's connection to the server (namespace `/print-agents`, device token in the handshake):
 * - reports its printers with `agent.hello` on every connection and whenever the list changes;
 * - prints `print.job`s through a `JobProcessor` and confirms each with `print.result`, resending a result
 *   until the server acknowledges it (results that could not be sent wait for the next connection);
 * - reconnects forever with backoff (1 s → 30 s), except when the server says the agent was revoked.
 */
export class AgentClient {
  /** The owner's settings per printer key (from the hello ack and `agent.config`). */
  readonly settings = new Map<string, AgentPrinter>();
  restaurantName: string | null = null;
  agentName: string | null = null;

  private readonly options: Required<Omit<AgentClientOptions, "beforeRescan" | "ioFactory">> &
    Pick<AgentClientOptions, "beforeRescan" | "ioFactory">;
  private readonly processor: JobProcessor;
  /** Results not acknowledged yet, by job id. */
  private readonly pending = new Map<string, PrintResultInput>();
  private readonly sending = new Set<string>();
  private socket: AgentSocket | null = null;
  private rescanTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private helloRetryTimer: NodeJS.Timeout | null = null;
  private unauthorizedCount = 0;
  private manualAttempts = 0;
  private revoked = false;
  private stopped = false;
  private rescanning = false;

  constructor(options: AgentClientOptions) {
    this.options = {
      rescanMs: 60_000,
      ackTimeoutMs: 10_000,
      helloTimeoutMs: 15_000,
      unauthorizedLimit: 3,
      reconnectDelayMs: 1_000,
      reconnectDelayMaxMs: 30_000,
      ...options,
    };
    this.processor = new JobProcessor({
      printers: options.printers,
      logger: options.logger,
      sendResult: (result) => this.sendResult(result),
    });
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  /** Results waiting for an ack (tests, shutdown log). */
  get pendingResults(): number {
    return this.pending.size;
  }

  start(): void {
    const { serverUrl, token, reconnectDelayMs, reconnectDelayMaxMs, logger } = this.options;
    const create = this.options.ioFactory ?? ((url, opts) => io(url, opts) as AgentSocket);
    const socket = create(`${serverUrl}${PRINT_AGENT_NAMESPACE}`, {
      auth: { token },
      // WebSocket first; if it cannot be opened (a proxy that blocks upgrades), long polling.
      transports: ["websocket", "polling"],
      tryAllTransports: true,
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: reconnectDelayMs,
      reconnectionDelayMax: reconnectDelayMaxMs,
      randomizationFactor: 0.5,
      timeout: 20_000,
    });
    this.socket = socket;

    socket.on("connect", () => {
      this.unauthorizedCount = 0;
      this.manualAttempts = 0;
      logger.info("Conectado al servidor", { transport: socket.io.engine?.transport?.name });
      this.sendHello();
      this.flushResults();
    });
    socket.on("connect_error", (error: Error) => this.onConnectError(error));
    socket.on("disconnect", (reason) => {
      logger.warn("Desconectado del servidor", { reason });
      // The server closed the connection on purpose: socket.io does not reconnect by itself in that case.
      if (reason === "io server disconnect" && !this.revoked && !this.stopped) this.scheduleManualConnect();
    });
    socket.on(PRINT_AGENT_EVENTS.revoked, () => this.revoke("revoked"));
    socket.on(PRINT_AGENT_EVENTS.config, (payload) => this.applyConfig(payload));
    socket.on(PRINT_AGENT_EVENTS.job, (job) => {
      if (this.revoked || this.stopped) return;
      this.processor.handle(job);
    });

    this.rescanTimer = setInterval(() => void this.rescan(), this.options.rescanMs);
  }

  /**
   * Disconnects and waits (at most `graceMs`) for the jobs being printed. Results not delivered are lost:
   * the server sends those jobs again on the next connection and the agent prints them again.
   */
  async stop(graceMs = 10_000): Promise<void> {
    this.stopped = true;
    for (const timer of [this.rescanTimer, this.reconnectTimer, this.helloRetryTimer]) {
      if (timer) clearTimeout(timer);
    }
    let graceTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      this.processor.idle(),
      new Promise<void>((resolve) => {
        graceTimer = setTimeout(resolve, graceMs);
      }),
    ]);
    clearTimeout(graceTimer);
    this.socket?.disconnect();
    this.socket?.removeAllListeners();
  }

  /** Reports the printers again (the list changed). */
  sendHello(): void {
    const socket = this.socket;
    if (!socket?.connected || this.revoked) return;
    if (this.helloRetryTimer) clearTimeout(this.helloRetryTimer);
    const { logger, appVersion, printers, helloTimeoutMs } = this.options;
    const input = { appVersion, printers: printers.reported() };
    socket
      .timeout(helloTimeoutMs)
      .emitWithAck(PRINT_AGENT_EVENTS.hello, input)
      .then((result: AgentHelloResult) => {
        if (result.ok) {
          this.restaurantName = result.restaurantName;
          this.agentName = result.agentName;
          this.replaceSettings(result.printers);
          logger.info(`Vinculado a "${result.restaurantName}" como "${result.agentName}"`, {
            printers: input.printers.length,
            enabled: result.printers.filter((printer) => printer.enabled).length,
          });
          return;
        }
        if (result.code === "AGENT_REVOKED") {
          this.revoke("revoked");
          return;
        }
        logger.error("El servidor rechazó el saludo del agente", { code: result.code });
      })
      .catch((error: unknown) => {
        if (this.stopped || this.revoked) return;
        logger.warn("El servidor no respondió al saludo; se reintenta", { err: error });
        this.helloRetryTimer = setTimeout(() => this.sendHello(), 5_000);
      });
  }

  /** Queues a result for delivery (kept until the server acknowledges it). */
  sendResult(result: PrintResultInput): void {
    this.pending.set(result.jobId, result);
    this.trySend(result.jobId);
  }

  private trySend(jobId: string): void {
    const socket = this.socket;
    const result = this.pending.get(jobId);
    if (!result || !socket?.connected || this.sending.has(jobId) || this.revoked) return;
    this.sending.add(jobId);
    const { logger, ackTimeoutMs } = this.options;
    socket
      .timeout(ackTimeoutMs)
      .emitWithAck(PRINT_AGENT_EVENTS.result, result)
      .then((ack) => {
        if (this.pending.get(jobId) === result) this.pending.delete(jobId);
        if (ack.ok) return;
        if (ack.code === "AGENT_REVOKED") this.revoke("revoked");
        else logger.warn("El servidor no aceptó el resultado de impresión", { jobId, code: ack.code });
      })
      .catch(() => {
        logger.warn("Sin confirmación del resultado de impresión; se reintenta", { jobId });
      })
      .finally(() => {
        this.sending.delete(jobId);
        // Not acknowledged (timeout) or replaced by a newer result meanwhile: send again while connected.
        if (this.pending.has(jobId) && socket.connected && !this.stopped) setImmediate(() => this.trySend(jobId));
      });
  }

  private flushResults(): void {
    for (const jobId of this.pending.keys()) this.trySend(jobId);
  }

  private onConnectError(error: Error): void {
    const { logger, unauthorizedLimit } = this.options;
    if (error.message === PRINT_AGENT_UNAUTHORIZED) {
      this.unauthorizedCount++;
      logger.warn("El servidor rechazó el token de este equipo", { attempt: this.unauthorizedCount });
      if (this.unauthorizedCount >= unauthorizedLimit) {
        this.revoke("unauthorized");
        return;
      }
    } else {
      logger.warn("No se pudo conectar con el servidor; se reintenta", { err: error });
    }
    // An error from the server's middleware (unauthorized, unavailable) stops socket.io's own reconnection.
    if (!this.socket?.active) this.scheduleManualConnect();
  }

  private scheduleManualConnect(): void {
    if (this.reconnectTimer || this.revoked || this.stopped) return;
    const { reconnectDelayMs, reconnectDelayMaxMs } = this.options;
    const delay = Math.min(reconnectDelayMaxMs, reconnectDelayMs * 2 ** this.manualAttempts);
    this.manualAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.revoked && !this.stopped && !this.socket?.connected) this.socket?.connect();
    }, delay);
  }

  private revoke(reason: RevokedReason): void {
    if (this.revoked) return;
    this.revoked = true;
    this.options.logger.error(
      reason === "revoked" ? "El dueño desvinculó este equipo" : "El servidor ya no acepta el token de este equipo",
    );
    for (const timer of [this.rescanTimer, this.reconnectTimer, this.helloRetryTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.socket?.disconnect();
    this.options.onRevoked(reason);
  }

  private applyConfig(payload: AgentConfigPayload): void {
    if (typeof payload !== "object" || payload === null || !Array.isArray(payload.printers)) return;
    this.agentName = payload.agentName;
    this.replaceSettings(payload.printers);
    const summary = payload.printers
      .map((printer) => {
        const state = printer.enabled ? `activa, ${printer.paper} mm` : "desactivada";
        // Printers this agent no longer reports are kept by the server with their settings, without jobs.
        return `${printer.name}: ${state}${printer.reported === false ? ", no detectada en este equipo" : ""}`;
      })
      .join("; ");
    this.options.logger.info(`Configuración actualizada (${summary || "sin impresoras"})`);
  }

  private replaceSettings(printers: AgentPrinter[]): void {
    this.settings.clear();
    for (const printer of printers) this.settings.set(printer.key, printer);
  }

  private async rescan(): Promise<void> {
    if (this.rescanning || this.stopped || this.revoked) return;
    this.rescanning = true;
    try {
      await this.options.beforeRescan?.();
      const changed = await this.options.printers.refresh();
      if (changed) {
        this.options.logger.info("Cambió la lista de impresoras de este equipo", {
          printers: this.options.printers.reported().map((printer) => printer.name),
        });
        this.sendHello();
      }
    } catch (error) {
      this.options.logger.warn("No se pudieron revisar las impresoras", { err: error });
    } finally {
      this.rescanning = false;
    }
  }
}
