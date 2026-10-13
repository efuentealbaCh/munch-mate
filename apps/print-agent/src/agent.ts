import { AgentClient, type RevokedReason } from "./client";
import { type AgentConfig, isPaired, loadConfig, type PairedConfig, saveConfig } from "./config";
import { acquireLock } from "./lock";
import type { Logger } from "./logger";
import { PrinterRegistry } from "./printers/registry";
import { AGENT_VERSION } from "./version";

/** Exit codes of the agent (the hidden launcher ignores them; they help support read the log). */
export const EXIT = { ok: 0, error: 1, usage: 2, revoked: 3, alreadyRunning: 4 } as const;

export const REVOKED_MESSAGE = "Este equipo fue desvinculado; vuelve a vincularlo (abre munchmate-impresora.exe e ingresa un código nuevo).";

/**
 * Runs the agent until it is stopped (Ctrl+C, closing the window, logoff) or revoked.
 * @returns The process exit code.
 */
export async function runAgent(config: PairedConfig, home: string, logger: Logger): Promise<number> {
  const lock = acquireLock(home);
  if (!lock.ok) {
    logger.warn(`El agente ya está funcionando en este equipo (proceso ${lock.pid}).`);
    return EXIT.alreadyRunning;
  }
  try {
    const printers = new PrinterRegistry({ home, logger });
    printers.setNetworkPrinters(config.networkPrinters);
    await printers.refresh();
    const found = printers.reported();
    logger.info(
      found.length > 0
        ? `Impresoras de este equipo: ${found.map((printer) => `${printer.name} [${printer.key}]`).join(", ")}`
        : "No se encontraron impresoras en este equipo: instala la impresora en Windows o agrega una de red (--add-network).",
    );
    logger.info(`Conectando con ${config.serverUrl} (agente ${AGENT_VERSION})...`);

    return await new Promise<number>((resolve) => {
      let finished = false;
      const finish = async (code: number) => {
        if (finished) return;
        finished = true;
        for (const signal of SIGNALS) process.off(signal, onSignal);
        await client.stop().catch((error: unknown) => logger.warn("Error al detener el agente", { err: error }));
        if (client.pendingResults > 0) {
          logger.warn(`${client.pendingResults} resultado(s) de impresión sin confirmar; el servidor reenviará esos trabajos`);
        }
        resolve(code);
      };
      const onSignal = (signal: NodeJS.Signals) => {
        logger.info(`Deteniendo el agente (${signal})...`);
        void finish(EXIT.ok);
      };

      const onRevoked = (reason: RevokedReason) => {
        void forgetToken(home, logger).finally(() => {
          logger.error(REVOKED_MESSAGE, { reason });
          void finish(EXIT.revoked);
        });
      };

      const client = new AgentClient({
        serverUrl: config.serverUrl,
        token: config.token,
        appVersion: AGENT_VERSION,
        printers,
        logger,
        onRevoked,
        // `--add-network` / `--remove-network` / `--unpair` from another window take effect within a minute.
        beforeRescan: async () => {
          let current: AgentConfig | null;
          try {
            current = await loadConfig(home);
          } catch (error) {
            logger.warn("No se pudo releer la configuración", { err: error });
            return;
          }
          if (!isPaired(current) || current.token !== config.token) {
            logger.warn("La configuración cambió (equipo desvinculado o vinculado de nuevo): el agente se detiene.");
            void finish(EXIT.ok);
            return;
          }
          printers.setNetworkPrinters(current.networkPrinters);
        },
      });

      for (const signal of SIGNALS) process.on(signal, onSignal);
      client.start();
    });
  } finally {
    lock.release();
  }
}

/** SIGHUP: the console window was closed; SIGBREAK: Ctrl+Break on Windows. */
const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", ...(process.platform === "win32" ? (["SIGBREAK"] as const) : [])];

/** Keeps the config (server, name, network printers) without the revoked token. */
async function forgetToken(home: string, logger: Logger): Promise<void> {
  try {
    const current = await loadConfig(home);
    if (current) await saveConfig(home, { ...current, agentId: null, token: null });
  } catch (error) {
    logger.error("No se pudo borrar el token de la configuración", { err: error });
  }
}
