import { existsSync, promises as fs } from "node:fs";
import { join, resolve, win32 } from "node:path";
import type { ExecFile } from "./printers/types";
import { execFileAsync } from "./printers/windows";

/**
 * Start with Windows without admin rights: a value in the user's `Run` key (HKCU). It points to a small
 * VBScript next to the config that starts the agent with a hidden window (`WScript.Shell.Run …, 0`), because
 * the .exe is a console program and would otherwise leave a console window open on the desktop.
 *
 * Fallback: if `wscript.exe` is missing (Microsoft is phasing out VBScript as an optional Windows feature),
 * the Run value points to the .exe directly; it works, but a console window stays open (minimizable).
 */

export const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const RUN_VALUE = "MunchMateImpresora";
export const LAUNCHER_FILE = "iniciar-oculto.vbs";

/**
 * The command that runs this same program: the .exe itself when it is a Node single executable (SEA), or
 * `node <script>` in development.
 */
export function selfCommand(execPath: string, script: string | undefined, isSea: boolean): string[] {
  return isSea || !script ? [execPath] : [execPath, resolve(script)];
}

/** Whether this process is the single executable (`node:sea`, Node ≥ 20). */
export function runningAsSea(): boolean {
  try {
    const sea = require("node:sea") as { isSea(): boolean };
    return sea.isSea();
  } catch {
    return false;
  }
}

/** A Windows command line from arguments (paths quoted; Windows paths cannot contain quotes). */
export function commandLine(args: string[]): string {
  return args.map((arg) => (/[\s"]/.test(arg) || arg === "" ? `"${arg}"` : arg)).join(" ");
}

/** Content of the hidden launcher: runs `<command> --run` with window style 0 (hidden), without waiting. */
export function launcherScript(command: string[]): string {
  const line = commandLine([...command, "--run"]).replace(/"/g, '""');
  return [
    "' Munch Mate - arranca el agente de impresion sin ventana (generado por el agente; se borra con --uninstall-startup).",
    `CreateObject("WScript.Shell").Run "${line}", 0, False`,
    "",
  ].join("\r\n");
}

const system32 = (env: NodeJS.ProcessEnv) => win32.join(env.SystemRoot ?? env.windir ?? "C:\\Windows", "System32");
export const regPath = (env: NodeJS.ProcessEnv) => win32.join(system32(env), "reg.exe");
export const wscriptPath = (env: NodeJS.ProcessEnv) => win32.join(system32(env), "wscript.exe");

/** `reg add` arguments that set the Run value (`/f`: replace without asking). */
export function regAddArgs(data: string): string[] {
  return ["add", RUN_KEY, "/v", RUN_VALUE, "/t", "REG_SZ", "/d", data, "/f"];
}

export const regDeleteArgs = (): string[] => ["delete", RUN_KEY, "/v", RUN_VALUE, "/f"];
export const regQueryArgs = (): string[] => ["query", RUN_KEY, "/v", RUN_VALUE];

/** What goes in the Run value: wscript + launcher when available, else the command itself. */
export function runValueData(command: string[], launcher: string | null, wscript: string): string {
  return launcher ? commandLine([wscript, launcher]) : commandLine([...command, "--run"]);
}

export interface StartupOptions {
  home: string;
  command: string[];
  env?: NodeJS.ProcessEnv;
  exec?: ExecFile;
  /** Replaces the check for wscript.exe (tests). */
  hasWscript?: boolean;
}

/**
 * Registers the agent to start at logon.
 * @returns "hidden" (through the VBScript launcher) or "console" (the .exe directly).
 */
export async function installStartup(options: StartupOptions): Promise<"hidden" | "console"> {
  const env = options.env ?? process.env;
  const exec = options.exec ?? execFileAsync;
  const wscript = wscriptPath(env);
  const hidden = options.hasWscript ?? existsSync(wscript);
  let launcher: string | null = null;
  if (hidden) {
    await fs.mkdir(options.home, { recursive: true });
    launcher = join(options.home, LAUNCHER_FILE);
    // UTF-16LE with BOM: wscript reads BOM-less files in the ANSI code page, and the path may have accents.
    await fs.writeFile(launcher, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(launcherScript(options.command), "utf16le")]));
  }
  await exec(regPath(env), regAddArgs(runValueData(options.command, launcher, wscript)), { timeout: 15_000, windowsHide: true });
  return hidden ? "hidden" : "console";
}

/**
 * Removes the Run value and the launcher.
 * @returns Whether it was registered.
 */
export async function uninstallStartup(options: Omit<StartupOptions, "command" | "hasWscript">): Promise<boolean> {
  const env = options.env ?? process.env;
  const exec = options.exec ?? execFileAsync;
  const registered = await isStartupInstalled(options);
  if (registered) await exec(regPath(env), regDeleteArgs(), { timeout: 15_000, windowsHide: true });
  await fs.rm(join(options.home, LAUNCHER_FILE), { force: true });
  return registered;
}

/** Whether the Run value exists (`reg query` exits with 1 when it does not). */
export async function isStartupInstalled(options: Pick<StartupOptions, "env" | "exec">): Promise<boolean> {
  const env = options.env ?? process.env;
  const exec = options.exec ?? execFileAsync;
  try {
    await exec(regPath(env), regQueryArgs(), { timeout: 15_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
