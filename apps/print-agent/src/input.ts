import { isIP } from "node:net";
import { PRINT_LIMITS } from "@app/types";
import { cleanLabel, truncate } from "./text";

/**
 * Validation of what the owner types (wizard and command line). Every function returns either the clean
 * value or a message in Spanish to show as is.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });

/** Hosts where plain http is accepted (development against a local api). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The server's address as an origin ("https://dominio.cl"): https is added when missing and the trailing
 * slash removed. A path is rejected because Socket.IO would read it as part of the namespace. Plain http is
 * only accepted for localhost: the device token travels on this connection.
 */
export function normalizeServerUrl(input: string): Parsed<string> {
  let text = input.trim();
  if (!text) return fail("Escribe la dirección del servidor, por ejemplo https://tu-dominio.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return fail("La dirección del servidor no es válida (ejemplo: https://tu-dominio).");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return fail("La dirección debe empezar con https://.");
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    return fail("Usa https:// (http solo se permite con localhost, para pruebas).");
  }
  if (url.username || url.password) return fail("La dirección no debe incluir usuario ni contraseña.");
  if (url.search || url.hash) return fail("La dirección no debe incluir ? ni #.");
  if (url.pathname.replace(/\/+$/, "") !== "") return fail("Escribe solo el dominio, sin rutas (ejemplo: https://tu-dominio).");
  return ok(url.origin);
}

/** Name of this computer as the owner will see it: clean, not empty, at most 40 characters. */
export function normalizeAgentName(input: string): Parsed<string> {
  const name = truncate(cleanLabel(input), PRINT_LIMITS.agentNameMax);
  return name ? ok(name) : fail("Escribe un nombre para este equipo (por ejemplo, Cocina).");
}

/** Default name of this computer: its host name, cut to the server's limit. */
export function defaultAgentName(hostname: string): string {
  const name = truncate(cleanLabel(hostname), PRINT_LIMITS.agentNameMax);
  return name || "Cocina";
}

export const DEFAULT_PRINTER_PORT = 9100;

/** A network printer as the agent stores it. */
export interface NetworkPrinterConfig {
  name: string;
  host: string;
  port: number;
}

const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * "192.168.1.50", "192.168.1.50:9100", "impresora.local", "[fe80::1]:9100" → host and port (9100 by default).
 */
export function parseHostPort(input: string): Parsed<{ host: string; port: number }> {
  const text = input.trim();
  let host = text;
  let portText: string | undefined;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  if (bracketed) {
    host = bracketed[1] ?? "";
    portText = bracketed[2];
    if (isIP(host) !== 6) return fail(`"${text}" no es una dirección IPv6 válida.`);
  } else if (isIP(text) === 6) {
    host = text;
  } else {
    const colon = text.lastIndexOf(":");
    if (colon >= 0) {
      host = text.slice(0, colon);
      portText = text.slice(colon + 1);
    }
    if (!host) return fail("Escribe la IP de la impresora (por ejemplo, 192.168.1.50).");
    if (isIP(host) !== 4 && !HOSTNAME.test(host)) return fail(`"${host}" no es una IP ni un nombre de equipo válido.`);
  }
  let port = DEFAULT_PRINTER_PORT;
  if (portText !== undefined) {
    if (!/^\d{1,5}$/.test(portText)) return fail(`El puerto "${portText}" no es válido.`);
    port = Number(portText);
    if (port < 1 || port > 65535) return fail(`El puerto ${port} no es válido (1 a 65535).`);
  }
  return ok({ host: host.toLowerCase(), port });
}

/**
 * Validates a network printer to add: a clean name (≤ 100 characters) not used by another network printer
 * (case and accents aside) and a valid address that is not already configured.
 */
export function newNetworkPrinter(name: string, address: string, existing: NetworkPrinterConfig[]): Parsed<NetworkPrinterConfig> {
  const clean = truncate(cleanLabel(name), PRINT_LIMITS.printerNameMax);
  if (!clean) return fail("Escribe un nombre para la impresora (por ejemplo, Cocina caliente).");
  if (existing.some((printer) => sameName(printer.name, clean))) return fail(`Ya hay una impresora de red llamada "${clean}".`);
  const parsed = parseHostPort(address);
  if (!parsed.ok) return parsed;
  const { host, port } = parsed.value;
  const twin = existing.find((printer) => printer.host === host && printer.port === port);
  if (twin) return fail(`La dirección ${host}:${port} ya está configurada como "${twin.name}".`);
  return ok({ name: clean, host, port });
}

/** Names compared ignoring case, accents and extra spaces (like the server's `nameKey`). */
export function sameName(a: string, b: string): boolean {
  const key = (value: string) =>
    cleanLabel(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  return key(a) === key(b);
}

/** Answer of a yes/no question; empty takes the default. */
export function parseYesNo(input: string, defaultValue: boolean): boolean | null {
  const answer = input.trim().toLowerCase();
  if (!answer) return defaultValue;
  if (["s", "si", "sí", "y", "yes"].includes(answer)) return true;
  if (["n", "no"].includes(answer)) return false;
  return null;
}

// ── Command line ────────────────────────────────────────────────────────────

export type Command =
  | { kind: "default" }
  | { kind: "run" }
  | { kind: "pair"; server: string; code: string; name: string | null }
  | { kind: "add-network"; name: string; address: string }
  | { kind: "remove-network"; name: string }
  | { kind: "list-printers" }
  | { kind: "test"; printer: string; paper: "58" | "80" }
  | { kind: "install-startup" }
  | { kind: "uninstall-startup" }
  | { kind: "unpair" }
  | { kind: "version" }
  | { kind: "help" };

/**
 * Reads the command line (without the executable). No arguments = the double-click mode (wizard when not
 * paired, then run). Exactly one action per call.
 */
export function parseArgs(argv: string[]): Parsed<Command> {
  if (argv.length === 0) return ok({ kind: "default" });
  const [flag, ...rest] = argv;
  const noArgs = (command: Command): Parsed<Command> =>
    rest.length === 0 ? ok(command) : fail(`${flag} no recibe argumentos.`);
  switch (flag) {
    case "--run":
      return noArgs({ kind: "run" });
    case "--list-printers":
      return noArgs({ kind: "list-printers" });
    case "--install-startup":
      return noArgs({ kind: "install-startup" });
    case "--uninstall-startup":
      return noArgs({ kind: "uninstall-startup" });
    case "--unpair":
      return noArgs({ kind: "unpair" });
    case "--version":
    case "-v":
      return noArgs({ kind: "version" });
    case "--help":
    case "-h":
    case "/?":
      return noArgs({ kind: "help" });
    case "--add-network":
      if (rest.length !== 2) return fail('Uso: --add-network "<nombre>" <ip[:puerto]>');
      return ok({ kind: "add-network", name: rest[0] ?? "", address: rest[1] ?? "" });
    case "--remove-network":
      if (rest.length !== 1) return fail('Uso: --remove-network "<nombre>"');
      return ok({ kind: "remove-network", name: rest[0] ?? "" });
    case "--test": {
      const [printer, ...options] = rest;
      if (!printer) return fail('Uso: --test "<impresora>" [--paper 58|80]');
      let paper: "58" | "80" = "80";
      if (options.length > 0) {
        if (options.length !== 2 || options[0] !== "--paper" || (options[1] !== "58" && options[1] !== "80")) {
          return fail('Uso: --test "<impresora>" [--paper 58|80]');
        }
        paper = options[1];
      }
      return ok({ kind: "test", printer, paper });
    }
    case "--server":
    case "--code":
    case "--name": {
      const values = new Map<string, string>();
      for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i] ?? "";
        const value = argv[i + 1];
        if (!["--server", "--code", "--name"].includes(key)) return fail(`Opción desconocida junto a --server/--code: ${key}`);
        if (value === undefined || value.startsWith("--")) return fail(`Falta el valor de ${key}.`);
        if (values.has(key)) return fail(`${key} está repetido.`);
        values.set(key, value);
      }
      const server = values.get("--server");
      const code = values.get("--code");
      if (!server || !code) return fail('Para vincular sin preguntas usa: --server <url> --code <código> [--name "<nombre>"]');
      return ok({ kind: "pair", server, code, name: values.get("--name") ?? null });
    }
    default:
      return fail(`Opción desconocida: ${flag}. Usa --help para ver las opciones.`);
  }
}

export const HELP_TEXT = `Munch Mate · Agente de impresión

Uso: munchmate-impresora.exe [opción]

Sin opciones (doble clic): si el equipo no está vinculado, pregunta los datos y lo vincula; luego queda
imprimiendo hasta que cierres la ventana.

  --server <url> --code <código> [--name "<nombre>"]
                              Vincula este equipo sin preguntas (el código sale en Ajustes → Impresoras).
  --run                       Solo imprime (lo usa el arranque automático con Windows).
  --list-printers             Muestra las impresoras que este equipo puede usar.
  --test "<impresora>" [--paper 58|80]
                              Imprime una página de prueba sin conectarse al servidor
                              (clave o nombre de --list-printers; papel de 80 mm si no se indica).
  --add-network "<nombre>" <ip[:puerto]>
                              Agrega una impresora de red (puerto 9100 si no se indica).
  --remove-network "<nombre>" Quita una impresora de red.
  --install-startup           Arranca el agente al iniciar sesión en Windows, sin ventana.
  --uninstall-startup         Deja de arrancarlo con Windows.
  --unpair                    Desvincula este equipo: borra su configuración y el arranque automático.
  --version                   Muestra la versión.
  --help                      Muestra esta ayuda.
`;
