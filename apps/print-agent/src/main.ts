import { hostname } from "node:os";
import { join } from "node:path";
import { layoutTicket, normalizePairingCode, testTicket, ticketColumns } from "@app/utils";
import { EXIT, REVOKED_MESSAGE, runAgent } from "./agent";
import { type AgentConfig, ConfigError, agentHome, configPath, deleteConfig, isPaired, loadConfig, saveConfig } from "./config";
import { layoutToEscPos } from "./escpos";
import { type Command, HELP_TEXT, defaultAgentName, newNetworkPrinter, normalizeAgentName, normalizeServerUrl, parseArgs, sameName } from "./input";
import { createLogger, type Logger } from "./logger";
import { PairError, pairAgent } from "./pair";
import { PrinterRegistry } from "./printers/registry";
import { installStartup, runningAsSea, selfCommand, uninstallStartup } from "./startup";
import { AGENT_VERSION } from "./version";
import { InputClosedError, pairingWizard, pressEnterToClose, say } from "./wizard";

/**
 * Command line of the agent. Every command returns an exit code; user-facing text goes through `say` (the
 * console) and anything worth keeping through the logger (file + console).
 */
export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    say(parsed.error);
    return EXIT.usage;
  }
  const command = parsed.value;
  const home = agentHome();
  // Commands that keep running log to the file; one-shot commands only to the console.
  const logger = createLogger({ dir: command.kind === "run" || command.kind === "default" ? join(home, "logs") : null, console: true });
  // Double-click: keep the window open after a message, or it closes before the owner can read it.
  const interactive = command.kind === "default";
  try {
    const code = await execute(command, home, logger);
    if (interactive && code !== EXIT.ok) await pressEnterToClose();
    return code;
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(`La configuración no se puede leer: ${error.message}. Corrígela o vincula de nuevo con --unpair.`);
    } else if (error instanceof InputClosedError) {
      logger.error(error.message);
    } else if (error instanceof PairError) {
      logger.error(error.message, { code: error.code });
    } else {
      logger.error("Error inesperado", { err: error });
    }
    if (interactive) await pressEnterToClose();
    return EXIT.error;
  }
}

async function execute(command: Command, home: string, logger: Logger): Promise<number> {
  switch (command.kind) {
    case "version":
      say(AGENT_VERSION);
      return EXIT.ok;
    case "help":
      say(HELP_TEXT);
      return EXIT.ok;
    case "run": {
      const config = await loadConfig(home);
      if (!isPaired(config)) {
        logger.error(config ? REVOKED_MESSAGE : "Este equipo no está vinculado: abre munchmate-impresora.exe para vincularlo.");
        return EXIT.usage;
      }
      return runAgent(config, home, logger);
    }
    case "default": {
      let config = await loadConfig(home);
      if (!isPaired(config)) {
        if (config) say(REVOKED_MESSAGE);
        config = await pairingWizard(home, ownCommand(), config);
      }
      if (!isPaired(config)) return EXIT.error;
      say(`Imprimiendo para "${config.restaurantName}". Deja esta ventana abierta (o minimízala); ciérrala para detener el agente.`);
      return runAgent(config, home, logger);
    }
    case "pair":
      return pairNow(command, home);
    case "list-printers":
      return listPrinters(home, logger);
    case "test":
      return printTest(command, home, logger);
    case "add-network": {
      const config = await requireConfig(home);
      if (!config) return EXIT.usage;
      const printer = newNetworkPrinter(command.name, command.address, config.networkPrinters);
      if (!printer.ok) {
        say(printer.error);
        return EXIT.usage;
      }
      await saveConfig(home, { ...config, networkPrinters: [...config.networkPrinters, printer.value] });
      say(`Impresora de red agregada: ${printer.value.name} (${printer.value.host}:${printer.value.port}).`);
      say("Si el agente está funcionando, la informa al servidor en menos de un minuto. Luego actívala en Ajustes → Impresoras.");
      return EXIT.ok;
    }
    case "remove-network": {
      const config = await requireConfig(home);
      if (!config) return EXIT.usage;
      const kept = config.networkPrinters.filter((printer) => !sameName(printer.name, command.name));
      if (kept.length === config.networkPrinters.length) {
        say(`No hay una impresora de red llamada "${command.name}".`);
        return EXIT.usage;
      }
      await saveConfig(home, { ...config, networkPrinters: kept });
      say(`Impresora de red "${command.name}" quitada.`);
      return EXIT.ok;
    }
    case "install-startup": {
      if (!windowsOnly()) return EXIT.usage;
      const mode = await installStartup({ home, command: ownCommand() });
      say(mode === "hidden" ? "Listo: el agente arrancará sin ventana al iniciar sesión en Windows." : "Listo: el agente arrancará al iniciar sesión (con una ventana de consola).");
      return EXIT.ok;
    }
    case "uninstall-startup": {
      if (!windowsOnly()) return EXIT.usage;
      const removed = await uninstallStartup({ home });
      say(removed ? "Listo: el agente ya no arranca con Windows." : "El agente no estaba registrado para arrancar con Windows.");
      return EXIT.ok;
    }
    case "unpair": {
      const removed = await deleteConfig(home);
      if (process.platform === "win32") await uninstallStartup({ home });
      say(removed ? "Listo: este equipo se desvinculó y se borró su token." : "Este equipo no estaba vinculado.");
      say("Elimínalo también en Munch Mate (Ajustes → Impresoras) para que deje de aparecer en la lista.");
      return EXIT.ok;
    }
  }
}

/** The command that starts this program again (for the start with Windows). */
const ownCommand = () => selfCommand(process.execPath, process.argv[1], runningAsSea());

function windowsOnly(): boolean {
  if (process.platform === "win32") return true;
  say("El arranque automático solo está disponible en Windows.");
  return false;
}

async function requireConfig(home: string): Promise<AgentConfig | null> {
  const config = await loadConfig(home);
  if (!config) say("Primero vincula este equipo (abre munchmate-impresora.exe o usa --server y --code).");
  return config;
}

/** `--server --code [--name]`: pairs without questions (keeps network printers of a previous config). */
async function pairNow(command: Extract<Command, { kind: "pair" }>, home: string): Promise<number> {
  const server = normalizeServerUrl(command.server);
  if (!server.ok) {
    say(server.error);
    return EXIT.usage;
  }
  const code = normalizePairingCode(command.code);
  if (!code) {
    say("El código tiene 8 letras y números (ej. K7MX-3QPA).");
    return EXIT.usage;
  }
  const name = normalizeAgentName(command.name ?? defaultAgentName(hostname()));
  if (!name.ok) {
    say(name.error);
    return EXIT.usage;
  }
  let previous: AgentConfig | null = null;
  try {
    previous = await loadConfig(home);
  } catch {
    // A broken previous config is replaced by the new pairing.
  }
  const paired = await pairAgent(server.value, { code, name: name.value, appVersion: AGENT_VERSION });
  await saveConfig(home, {
    serverUrl: server.value,
    agentId: paired.agentId,
    token: paired.token,
    agentName: name.value,
    restaurantName: paired.restaurantName,
    networkPrinters: previous?.networkPrinters ?? [],
  });
  say(`Listo: este equipo quedó vinculado a "${paired.restaurantName}" como "${name.value}".`);
  say(`Configuración guardada en ${configPath(home)} (contiene el token del equipo: no la compartas).`);
  return EXIT.ok;
}

async function registryFor(home: string, logger: Logger): Promise<{ printers: PrinterRegistry; config: AgentConfig | null }> {
  const config = await loadConfig(home).catch(() => null);
  const printers = new PrinterRegistry({ home, logger });
  printers.setNetworkPrinters(config?.networkPrinters ?? []);
  await printers.refresh();
  return { printers, config };
}

async function listPrinters(home: string, logger: Logger): Promise<number> {
  const { printers } = await registryFor(home, logger);
  const list = printers.list();
  if (list.length === 0) {
    say(
      process.platform === "win32"
        ? "No se encontraron impresoras. Instala la impresora en Windows (con su driver) o agrega una de red con --add-network."
        : "No hay impresoras de red configuradas (en este sistema solo se usan impresoras de red y MUNCHMATE_PRINT_DIR).",
    );
    return EXIT.ok;
  }
  say("Impresoras de este equipo:");
  for (const printer of list) say(`  ${printer.kind === "network" ? "Red" : "USB"}  ${printer.name}    (clave: ${printer.key})`);
  say("");
  say('Prueba una con: munchmate-impresora.exe --test "<nombre o clave>" [--paper 58|80]');
  return EXIT.ok;
}

/** Prints the shared test page (`testTicket`) directly, without the server. */
async function printTest(command: Extract<Command, { kind: "test" }>, home: string, logger: Logger): Promise<number> {
  const { printers, config } = await registryFor(home, logger);
  const printer = printers.findByKeyOrName(command.printer);
  if (!printer) {
    say(`No se encontró la impresora "${command.printer}". Usa --list-printers para ver los nombres.`);
    return EXIT.usage;
  }
  const ticket = testTicket(config?.restaurantName || "Munch Mate", printer.name, command.paper, new Date());
  const bytes = layoutToEscPos(layoutTicket(ticket, ticketColumns(command.paper)), 1);
  say(`Imprimiendo una página de prueba en "${printer.name}" (papel ${command.paper} mm)...`);
  await printer.send(bytes, "Munch Mate prueba");
  say("Enviada. Si no salió, revisa que la impresora esté encendida, con papel y conectada.");
  return EXIT.ok;
}
