import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, win32, posix } from "node:path";
import { type NetworkPrinterConfig, normalizeServerUrl, parseHostPort } from "./input";
import { cleanLabel } from "./text";

/**
 * Configuration file of the agent. It holds the device token, which is a credential of the restaurant: it
 * lives only in the user's profile (on Windows `%APPDATA%` is private to the user) and is never logged.
 */
export interface AgentConfig {
  serverUrl: string;
  /** null after the server revoked the agent (the rest is kept so pairing again needs fewer answers). */
  agentId: string | null;
  token: string | null;
  agentName: string;
  restaurantName: string;
  networkPrinters: NetworkPrinterConfig[];
}

/** A config with a device token: the agent can connect. */
export type PairedConfig = AgentConfig & { agentId: string; token: string };

export const isPaired = (config: AgentConfig | null): config is PairedConfig =>
  Boolean(config?.token && config.agentId);

/**
 * Directory of the agent's files (config, lock, logs, hidden launcher):
 * - Windows: `%APPDATA%\MunchMate\print-agent`
 * - elsewhere: `$XDG_CONFIG_HOME/munchmate-print-agent` (default `~/.config/munchmate-print-agent`)
 * `MUNCHMATE_AGENT_HOME` overrides it (tests, several agents on one development machine).
 */
export function agentHome(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.MUNCHMATE_AGENT_HOME) return env.MUNCHMATE_AGENT_HOME;
  if (platform === "win32") {
    return win32.join(env.APPDATA ?? win32.join(home, "AppData", "Roaming"), "MunchMate", "print-agent");
  }
  return posix.join(env.XDG_CONFIG_HOME || posix.join(home, ".config"), "munchmate-print-agent");
}

export const configPath = (dir: string) => join(dir, "config.json");

export class ConfigError extends Error {}

/**
 * Checks a parsed config.json. Unknown fields are dropped; a broken file is an error the owner must hear
 * about (never silently replaced: it may hold the only copy of the token).
 */
export function validateConfig(raw: unknown): AgentConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ConfigError("no es un objeto JSON");
  const data = raw as Record<string, unknown>;
  const text = (key: string, required: boolean): string | null => {
    const value = data[key];
    if (value === undefined || value === null) {
      if (required) throw new ConfigError(`falta "${key}"`);
      return null;
    }
    if (typeof value !== "string") throw new ConfigError(`"${key}" debe ser texto`);
    return value;
  };
  const server = normalizeServerUrl(text("serverUrl", true) ?? "");
  if (!server.ok) throw new ConfigError(`"serverUrl": ${server.error}`);
  const agentId = text("agentId", false);
  const token = text("token", false);
  const printers = data.networkPrinters ?? [];
  if (!Array.isArray(printers)) throw new ConfigError('"networkPrinters" debe ser una lista');
  const networkPrinters = (printers as unknown[]).map((printer, index) => {
    const entry = (printer ?? {}) as Record<string, unknown>;
    const name = typeof entry.name === "string" ? cleanLabel(entry.name) : "";
    const host = String(entry.host ?? "");
    const address = parseHostPort(`${host.includes(":") ? `[${host}]` : host}:${String(entry.port ?? "")}`);
    if (!name || !address.ok || typeof entry.port !== "number") {
      throw new ConfigError(`la impresora de red número ${index + 1} no es válida`);
    }
    return { name, host: address.value.host, port: address.value.port };
  });
  return {
    serverUrl: server.value,
    agentId: agentId || null,
    token: token || null,
    agentName: text("agentName", false) ?? "",
    restaurantName: text("restaurantName", false) ?? "",
    networkPrinters,
  };
}

/**
 * Reads the config.
 * @returns null when there is no config file yet.
 * @throws ConfigError when the file exists but cannot be used.
 */
export async function loadConfig(dir: string): Promise<AgentConfig | null> {
  let content: string;
  try {
    content = await fs.readFile(configPath(dir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ConfigError(`no se pudo leer ${configPath(dir)}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content);
  } catch {
    throw new ConfigError(`${configPath(dir)} no es JSON válido`);
  }
  try {
    return validateConfig(parsed);
  } catch (error) {
    throw new ConfigError(`${configPath(dir)}: ${(error as Error).message}`);
  }
}

/**
 * Writes the config atomically: a temporary file in the same directory, then rename over the old one, so a
 * crash or power cut never leaves a half-written file (the token would be lost).
 * The file is created with mode 600 (effective on Linux/macOS; on Windows the profile is already private).
 */
export async function saveConfig(dir: string, config: AgentConfig): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = configPath(dir);
  const temp = join(dir, `.config-${randomBytes(6).toString("hex")}.tmp`);
  try {
    await fs.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await renameWithRetry(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * rename() over an existing file can fail for a moment on Windows (EPERM/EBUSY) while another process (an
 * antivirus, the other agent command reading it) has it open: retry a few times before giving up.
 */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= attempts || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

/** Removes the config (unpairing). */
export async function deleteConfig(dir: string): Promise<boolean> {
  try {
    await fs.unlink(configPath(dir));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
