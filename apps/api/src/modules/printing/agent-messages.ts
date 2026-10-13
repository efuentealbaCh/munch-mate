import {
  type AgentHelloInput,
  PRINT_LIMITS,
  PRINTER_KINDS,
  type PrinterKind,
  type PrintResultInput,
  type ReportedPrinter,
} from "@app/types";
import { cleanLine } from "../../common/validation/clean-text";

/**
 * Validation of what print agents send over Socket.IO (no class-validator pipe runs on gateway messages).
 * Agents are trusted devices of the restaurant, but their payloads are still checked like any input.
 */

const line = (value: unknown): string | null => {
  const cleaned = cleanLine({ value });
  return typeof cleaned === "string" ? cleaned : null;
};

/**
 * `agent.hello`: the app version and the printers it reaches. Printers with a repeated key keep the first;
 * invalid ones make the whole payload invalid (the agent has a bug the owner should hear about).
 * @returns null when the payload is malformed.
 */
export function parseHello(payload: unknown): AgentHelloInput | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { appVersion, printers } = payload as Record<string, unknown>;
  const version = line(appVersion);
  if (version === null || version.length > PRINT_LIMITS.appVersionMax) return null;
  if (!Array.isArray(printers) || printers.length > PRINT_LIMITS.printersPerAgent) return null;
  const parsed = new Map<string, ReportedPrinter>();
  for (const printer of printers as unknown[]) {
    if (typeof printer !== "object" || printer === null) return null;
    const { key, name, kind } = printer as Record<string, unknown>;
    const cleanKey = line(key);
    const cleanName = line(name);
    if (!cleanKey || cleanKey.length > PRINT_LIMITS.printerKeyMax) return null;
    if (!cleanName || cleanName.length > PRINT_LIMITS.printerNameMax) return null;
    if (!PRINTER_KINDS.includes(kind as PrinterKind)) return null;
    if (!parsed.has(cleanKey)) parsed.set(cleanKey, { key: cleanKey, name: cleanName, kind: kind as PrinterKind });
  }
  return { appVersion: version, printers: [...parsed.values()] };
}

/**
 * `print.result`: which job and how it went. A long error message is cut; a failure without a message gets a
 * generic one.
 * @returns null when the payload is malformed.
 */
export function parseResult(payload: unknown): PrintResultInput | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { jobId, ok, error } = payload as Record<string, unknown>;
  if (typeof jobId !== "string" || !/^[0-9a-f]{24}$/.test(jobId) || typeof ok !== "boolean") return null;
  if (ok) return { jobId, ok };
  const message = line(error);
  return {
    jobId,
    ok,
    error: message ? Array.from(message).slice(0, PRINT_LIMITS.errorMax).join("") : "La impresora no respondió",
  };
}
