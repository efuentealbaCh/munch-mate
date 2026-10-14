import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal logger: one JSON object per line in `<home>/logs/agent.log` (rotated by size, a few old files kept)
 * plus a readable line on the console. Synchronous writes: the volume is a few lines per ticket and nothing
 * is lost if the process dies right after. Never log the device token or ticket contents (customer data).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface FileLoggerOptions {
  /** Directory of the log files; null = console only. */
  dir: string | null;
  /** Print to the console too (off when running hidden). */
  console: boolean;
  /** Rotate when the file reaches this size (bytes). */
  maxBytes?: number;
  /** Rotated files kept (agent.log.1 … agent.log.N). */
  keep?: number;
  /** Lowest level written. */
  level?: LogLevel;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Errors as plain fields (message and code; stacks only in the file). */
function serialize(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) return undefined;
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] =
      value instanceof Error
        ? { message: value.message, code: (value as NodeJS.ErrnoException).code, stack: value.stack }
        : value;
  }
  return out;
}

export function createLogger(options: FileLoggerOptions): Logger {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const keep = options.keep ?? 3;
  const min = ORDER[options.level ?? "info"];
  const file = options.dir ? join(options.dir, "agent.log") : null;
  let fileBroken = false;
  if (options.dir) {
    try {
      mkdirSync(options.dir, { recursive: true });
    } catch {
      fileBroken = true;
    }
  }

  const rotate = (path: string) => {
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      return;
    }
    if (size < maxBytes) return;
    rmSync(`${path}.${keep}`, { force: true });
    for (let index = keep - 1; index >= 1; index--) {
      try {
        renameSync(`${path}.${index}`, `${path}.${index + 1}`);
      } catch {
        // That rotated file does not exist yet.
      }
    }
    renameSync(path, `${path}.1`);
  };

  const write = (level: LogLevel, msg: string, fields?: LogFields) => {
    if (ORDER[level] < min) return;
    const time = new Date();
    if (file && !fileBroken) {
      try {
        rotate(file);
        appendFileSync(file, `${JSON.stringify({ time: time.toISOString(), level, msg, ...serialize(fields) })}\n`, "utf8");
      } catch {
        // A full disk or a locked file must not stop printing; the console still gets the line.
        fileBroken = true;
      }
    }
    if (options.console) {
      const hhmmss = time.toTimeString().slice(0, 8);
      const detail = fields?.err instanceof Error ? ` (${fields.err.message})` : "";
      const line = `[${hhmmss}] ${level === "info" ? "" : `${level.toUpperCase()}: `}${msg}${detail}\n`;
      (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line);
    }
  };

  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}

/** Logger that drops everything (tests). */
export const silentLogger: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
