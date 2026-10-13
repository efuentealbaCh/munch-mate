import { PRINT_JOB_KINDS, PRINT_LIMITS, type PrintJobPayload, type PrintLayout, type PrintResultInput } from "@app/types";
import { layoutToEscPos } from "./escpos";
import type { Logger } from "./logger";
import type { LocalPrinter } from "./printers/types";
import { LruSet, SerialQueues } from "./queue";

/** Job ids remembered as printed: a job re-sent after a reconnection is confirmed again, never reprinted. */
export const PRINTED_MEMORY = 500;

export const PRINTER_NOT_FOUND = "Impresora no encontrada en este equipo";
export const INVALID_JOB = "Trabajo de impresión inválido: actualiza el agente de impresión";

/** What the job processor needs from the printer registry. */
export interface PrinterLookup {
  find(key: string): LocalPrinter | undefined;
  /** Rescans the printers (a USB printer may have been plugged in a moment ago). */
  refresh(): Promise<boolean>;
}

const ALIGNS = new Set(["left", "center", "right"]);

/** Checks the shape of a `print.job` from the server (it is trusted, but a version mismatch must not crash). */
export function parseJob(payload: unknown): { job: PrintJobPayload } | { jobId: string | null; error: string } {
  if (typeof payload !== "object" || payload === null) return { jobId: null, error: INVALID_JOB };
  const data = payload as Record<string, unknown>;
  const jobId = typeof data.jobId === "string" && data.jobId.length > 0 && data.jobId.length <= 100 ? data.jobId : null;
  if (!jobId) return { jobId: null, error: INVALID_JOB };
  const layout = data.layout as Partial<PrintLayout> | undefined;
  const validLayout =
    typeof layout === "object" &&
    layout !== null &&
    Array.isArray(layout.lines) &&
    typeof layout.cut === "boolean" &&
    layout.lines.every(
      (line) =>
        typeof line === "object" &&
        line !== null &&
        typeof line.text === "string" &&
        ALIGNS.has(line.align) &&
        typeof line.bold === "boolean" &&
        (line.size === 1 || line.size === 2),
    );
  if (
    typeof data.printerKey !== "string" ||
    typeof data.copies !== "number" ||
    !PRINT_JOB_KINDS.includes(data.kind as PrintJobPayload["kind"]) ||
    !validLayout
  ) {
    return { jobId, error: INVALID_JOB };
  }
  return { job: data as unknown as PrintJobPayload };
}

/** An error message as the server keeps it: one line, at most `PRINT_LIMITS.errorMax` characters. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.replace(/\s+/g, " ").trim() || "La impresora no respondió";
  return Array.from(line).slice(0, PRINT_LIMITS.errorMax).join("");
}

/**
 * Prints the jobs the server sends: one queue per printer (serial), duplicates confirmed without printing,
 * and exactly one `print.result` per job received (handed to `sendResult`, which takes care of delivery).
 */
export class JobProcessor {
  private readonly queues = new SerialQueues();
  private readonly printed = new LruSet(PRINTED_MEMORY);
  /** Jobs queued or printing: a copy that arrives meanwhile is ignored (its result is sent once it ends). */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly options: {
      printers: PrinterLookup;
      logger: Logger;
      sendResult: (result: PrintResultInput) => void;
      encode?: (layout: PrintLayout, copies: number) => Buffer;
    },
  ) {}

  /** Takes a `print.job` payload. Never throws: every outcome becomes a result. */
  handle(payload: unknown): void {
    const { logger, sendResult } = this.options;
    const parsed = parseJob(payload);
    if (!("job" in parsed)) {
      logger.error("Trabajo de impresión inválido recibido del servidor", { jobId: parsed.jobId });
      if (parsed.jobId) sendResult({ jobId: parsed.jobId, ok: false, error: parsed.error });
      return;
    }
    const { job } = parsed;
    if (this.printed.has(job.jobId)) {
      logger.info("Trabajo repetido: ya estaba impreso, se confirma sin reimprimir", { jobId: job.jobId });
      sendResult({ jobId: job.jobId, ok: true });
      return;
    }
    if (this.inFlight.has(job.jobId)) {
      logger.debug("Trabajo repetido mientras se imprime: se ignora", { jobId: job.jobId });
      return;
    }
    this.inFlight.add(job.jobId);
    void this.queues
      .run(job.printerKey, () => this.print(job))
      .then(
        () => {
          this.printed.add(job.jobId);
          logger.info(`Impreso en ${job.printerKey}`, { jobId: job.jobId, printerKey: job.printerKey, kind: job.kind, copies: job.copies });
          sendResult({ jobId: job.jobId, ok: true });
        },
        (error: unknown) => {
          logger.warn("No se pudo imprimir", { jobId: job.jobId, printerKey: job.printerKey, err: error });
          sendResult({ jobId: job.jobId, ok: false, error: errorText(error) });
        },
      )
      .finally(() => this.inFlight.delete(job.jobId));
  }

  /** Resolves when nothing is queued or printing (shutdown). */
  idle(): Promise<void> {
    return this.queues.idle();
  }

  private async print(job: PrintJobPayload): Promise<void> {
    const { printers } = this.options;
    let printer = printers.find(job.printerKey);
    if (!printer) {
      await printers.refresh();
      printer = printers.find(job.printerKey);
    }
    if (!printer) throw new Error(PRINTER_NOT_FOUND);
    const bytes = (this.options.encode ?? layoutToEscPos)(job.layout, job.copies);
    await printer.send(bytes, `Munch Mate ${job.jobId}`);
  }
}
