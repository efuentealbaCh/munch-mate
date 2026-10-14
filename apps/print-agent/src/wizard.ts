import { hostname } from "node:os";
import { createInterface } from "node:readline";
import { formatPairingCode, normalizePairingCode } from "@app/utils";
import { type AgentConfig, saveConfig } from "./config";
import {
  defaultAgentName,
  type NetworkPrinterConfig,
  newNetworkPrinter,
  normalizeAgentName,
  normalizeServerUrl,
  parseYesNo,
} from "./input";
import { PairError, pairAgent } from "./pair";
import { installStartup } from "./startup";
import { AGENT_VERSION } from "./version";

/** Output of the interactive commands (what the owner reads on the console, not log lines). */
export const say = (text = "") => process.stdout.write(`${text}\n`);

/**
 * First-run wizard on the console, in Spanish: server address, computer name, pairing code (asked again
 * while it is wrong), then optional start with Windows and network printers. Saves the config.
 * @param previous A config without token (revoked agent): its answers are offered as defaults.
 * @returns The paired config.
 */
export async function pairingWizard(home: string, command: string[], previous: AgentConfig | null): Promise<AgentConfig> {
  const rl = new Prompt();
  try {
    say("");
    say("Munch Mate · Agente de impresión");
    say("================================");
    say("Vamos a vincular este computador con tu local. Necesitas el código de 8 caracteres que aparece");
    say("en Munch Mate, en Ajustes → Impresoras → Vincular equipo (dura 10 minutos).");
    say("");

    const serverUrl = await askValid(rl, "Dirección del servidor (ej. https://tu-dominio)", previous?.serverUrl, normalizeServerUrl);
    const name = await askValid(rl, "Nombre de este equipo", previous?.agentName || defaultAgentName(hostname()), normalizeAgentName);

    let paired: { agentId: string; token: string; restaurantName: string } | null = null;
    while (!paired) {
      const code = await askValid(rl, "Código de vinculación", undefined, (text) => {
        const normalized = normalizePairingCode(text);
        return normalized
          ? { ok: true as const, value: normalized }
          : { ok: false as const, error: "El código tiene 8 letras y números (ej. K7MX-3QPA). Revísalo e inténtalo de nuevo." };
      });
      say(`Vinculando con el código ${formatPairingCode(code)}...`);
      try {
        paired = await pairAgent(serverUrl, { code, name, appVersion: AGENT_VERSION });
      } catch (error) {
        if (!(error instanceof PairError)) throw error;
        say(`  ${error.message}`);
        if (error.code === "TOO_MANY_PRINT_AGENTS") throw error;
        if (error.code !== "INVALID_PAIRING_CODE") {
          const retry = await askYesNo(rl, "¿Intentar de nuevo?", true);
          if (!retry) throw error;
        } else {
          say("  Genera un código nuevo en Ajustes → Impresoras si el anterior venció.");
        }
      }
    }

    const config: AgentConfig = {
      serverUrl,
      agentId: paired.agentId,
      token: paired.token,
      agentName: name,
      restaurantName: paired.restaurantName,
      networkPrinters: previous?.networkPrinters ?? [],
    };
    await saveConfig(home, config);
    say("");
    say(`Listo: este equipo quedó vinculado a "${paired.restaurantName}" como "${name}".`);
    say("");

    if (process.platform === "win32" && (await askYesNo(rl, "¿Iniciar el agente automáticamente con Windows?", true))) {
      try {
        const mode = await installStartup({ home, command });
        say(
          mode === "hidden"
            ? "  Arrancará solo, sin ventana, cada vez que inicies sesión en Windows."
            : "  Arrancará solo al iniciar sesión (con una ventana de consola: no la cierres).",
        );
      } catch (error) {
        say(`  No se pudo registrar el arranque automático: ${(error as Error).message}`);
      }
    }

    const network: NetworkPrinterConfig[] = [...config.networkPrinters];
    while (await askYesNo(rl, "¿Agregar una impresora de red (con cable de red o Wi-Fi)?", false)) {
      const printerName = await rl.question("  Nombre (ej. Cocina caliente): ");
      const address = await rl.question("  IP de la impresora (ej. 192.168.1.50 o 192.168.1.50:9100): ");
      const parsed = newNetworkPrinter(printerName, address, network);
      if (!parsed.ok) {
        say(`  ${parsed.error}`);
        continue;
      }
      network.push(parsed.value);
      say(`  Agregada: ${parsed.value.name} (${parsed.value.host}:${parsed.value.port}).`);
    }
    if (network.length !== config.networkPrinters.length) {
      config.networkPrinters = network;
      await saveConfig(home, config);
    }
    say("");
    say("Ahora activa las impresoras de este equipo en Munch Mate: Ajustes → Impresoras.");
    say("");
    return config;
  } finally {
    rl.close();
  }
}

/** Asks until `parse` accepts the answer; an empty answer takes `fallback` when there is one. */
async function askValid<T>(
  rl: Prompt,
  label: string,
  fallback: string | undefined,
  parse: (text: string) => { ok: true; value: T } | { ok: false; error: string },
): Promise<T> {
  for (;;) {
    const answer = await rl.question(fallback ? `${label} [${fallback}]: ` : `${label}: `);
    const parsed = parse(answer.trim() || fallback || "");
    if (parsed.ok) return parsed.value;
    say(`  ${parsed.error}`);
  }
}

async function askYesNo(rl: Prompt, label: string, defaultValue: boolean): Promise<boolean> {
  for (;;) {
    const answer = parseYesNo(await rl.question(`${label} (${defaultValue ? "S/n" : "s/N"}): `), defaultValue);
    if (answer !== null) return answer;
    say("  Responde s (sí) o n (no).");
  }
}

/** "Presiona Enter para cerrar": keeps the window of a double-clicked .exe open so the message can be read. */
export async function pressEnterToClose(): Promise<void> {
  if (!process.stdin.isTTY) return;
  const rl = new Prompt();
  try {
    await rl.question("Presiona Enter para cerrar.");
  } catch {
    // Input closed: nothing to wait for.
  } finally {
    rl.close();
  }
}

/** The console input ended (closed window, piped input that ran out): the wizard cannot go on. */
export class InputClosedError extends Error {
  constructor() {
    super("Se cerró la entrada de la consola antes de terminar.");
  }
}

/**
 * Line-by-line questions on the console. Unlike readline/promises' `question`, lines typed (or piped) before a
 * question is asked are queued instead of lost, and a closed input rejects the pending question instead of
 * leaving it waiting forever. Ctrl+C cancels.
 */
class Prompt {
  private readonly lines: string[] = [];
  private waiting: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null;
  private closed = false;
  private readonly rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });

  constructor() {
    this.rl.on("line", (line) => {
      if (this.waiting) {
        const { resolve } = this.waiting;
        this.waiting = null;
        resolve(line);
      } else {
        this.lines.push(line);
      }
    });
    this.rl.on("close", () => {
      this.closed = true;
      this.waiting?.reject(new InputClosedError());
      this.waiting = null;
    });
    this.rl.on("SIGINT", () => {
      this.rl.close();
      say("");
      say("Cancelado.");
      process.exit(130);
    });
  }

  question(text: string): Promise<string> {
    process.stdout.write(text);
    // A terminal echoes what is typed; with piped input, echo the answer so the transcript reads well.
    const echo = (line: string) => {
      if (process.stdin.isTTY !== true) say(line);
      return line;
    };
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(echo(queued));
    if (this.closed) return Promise.reject(new InputClosedError());
    return new Promise((resolve, reject) => {
      this.waiting = { resolve: (line) => resolve(echo(line)), reject };
    });
  }

  close(): void {
    this.rl.close();
  }
}
