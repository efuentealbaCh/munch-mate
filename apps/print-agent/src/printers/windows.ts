import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { cleanLabel } from "../text";
import type { ExecError, ExecFile } from "./types";

/**
 * Printers installed in Windows (USB or any queue): listed with PowerShell/CIM and printed RAW through the
 * spooler (winspool.drv) from a PowerShell script, so the agent needs no native Node module.
 */

/** powershell.exe by absolute path: a program named powershell.exe in the PATH or the current directory is never run. */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(env.SystemRoot ?? env.windir ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** execFile as a promise; the error keeps code, killed, stdout and stderr. */
export const execFileAsync: ExecFile = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { ...options, encoding: "utf8", maxBuffer: options.maxBuffer ?? 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const failure = error as ExecError;
        failure.stdout = stdout;
        failure.stderr = stderr;
        reject(failure);
        return;
      }
      resolve({ stdout, stderr });
    });
  });

// ── Listing ─────────────────────────────────────────────────────────────────

/** UTF-8 output first: by default PowerShell writes to a pipe in the OEM code page and accents would break. */
export const LIST_PRINTERS_COMMAND =
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
  "Get-CimInstance -ClassName Win32_Printer | Select-Object Name,PortName,WorkOffline | ConvertTo-Json -Compress";

export interface WindowsPrinterInfo {
  name: string;
  portName: string;
  workOffline: boolean;
}

/** Ports of virtual printers that cannot take ESC/POS (PDF/XPS "save as" dialogs, fax, nowhere). */
const VIRTUAL_PORTS = new Set(["portprompt:", "shrfax:", "xpsport:", "nul:", "file:"]);
const VIRTUAL_NAMES = /^(microsoft print to pdf|microsoft xps document writer|fax)$|onenote/i;

/** Ports that are a file path (screen-capture printers like Snagit use "C:\ProgramData\…"): output goes to a file. */
const FILE_PORT = /^[a-z]:[\\/]/i;

/** Whether a Windows printer is a virtual one (PDF, XPS, fax, OneNote, file ports) that must not be offered. */
export function isVirtualPrinter(printer: WindowsPrinterInfo): boolean {
  const port = printer.portName.trim();
  return VIRTUAL_PORTS.has(port.toLowerCase()) || FILE_PORT.test(port) || VIRTUAL_NAMES.test(printer.name.trim());
}

/**
 * Parses the JSON of `LIST_PRINTERS_COMMAND`. PowerShell prints nothing when there are no printers, a single
 * object when there is one and an array otherwise. Entries without a name are skipped.
 * @throws Error when the output is not JSON.
 */
export function parseWin32Printers(stdout: string): WindowsPrinterInfo[] {
  const text = stdout.replace(/^\uFEFF/, "").trim();
  if (!text) return [];
  const parsed = JSON.parse(text) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const printers: WindowsPrinterInfo[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { Name, PortName, WorkOffline } = item as Record<string, unknown>;
    if (typeof Name !== "string" || !Name.trim()) continue;
    printers.push({ name: Name, portName: typeof PortName === "string" ? PortName : "", workOffline: WorkOffline === true });
  }
  return printers;
}

/**
 * Printers installed in Windows, without the virtual ones.
 * @throws Error when PowerShell fails (the caller keeps the previous list).
 */
export async function listWindowsPrinters(exec: ExecFile = execFileAsync, env: NodeJS.ProcessEnv = process.env): Promise<WindowsPrinterInfo[]> {
  const { stdout } = await exec(
    powershellPath(env),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", LIST_PRINTERS_COMMAND],
    { timeout: 30_000, windowsHide: true },
  );
  return parseWin32Printers(stdout).filter((printer) => !isVirtualPrinter(printer));
}

/** Key of a Windows printer as reported to the server ("usb:EPSON TM-T20"), cleaned like the server does. */
export const usbPrinterKey = (name: string) => `usb:${cleanLabel(name)}`;

// ── RAW printing ────────────────────────────────────────────────────────────

/**
 * PowerShell script that sends a file to a Windows printer as a RAW document (bytes go to the printer as is,
 * the driver does not render them). Every argument arrives base64-encoded (UTF-8): the printer name, the
 * file path and the document name are never interpolated in code and survive any quoting of the command
 * line (spaces, quotes, accents in names and user folders).
 */
export const RAW_PRINT_SCRIPT = String.raw`param(
  [Parameter(Mandatory = $true)][string]$PrinterB64,
  [Parameter(Mandatory = $true)][string]$PathB64,
  [Parameter(Mandatory = $true)][string]$DocNameB64
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  $utf8 = [System.Text.Encoding]::UTF8
  $printer = $utf8.GetString([Convert]::FromBase64String($PrinterB64))
  $path = $utf8.GetString([Convert]::FromBase64String($PathB64))
  $docName = $utf8.GetString([Convert]::FromBase64String($DocNameB64))
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class MunchMateRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DocInfo1
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo1 di);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    static Exception Fail(string step)
    {
        int code = Marshal.GetLastWin32Error();
        return new Win32Exception(code, step + ": " + new Win32Exception(code).Message);
    }

    public static void Send(string printer, byte[] data, string docName)
    {
        IntPtr handle;
        if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw Fail("OpenPrinter");
        try
        {
            DocInfo1 info = new DocInfo1();
            info.pDocName = docName;
            info.pOutputFile = null;
            info.pDatatype = "RAW";
            if (StartDocPrinter(handle, 1, info) == 0) throw Fail("StartDocPrinter");
            try
            {
                if (!StartPagePrinter(handle)) throw Fail("StartPagePrinter");
                try
                {
                    GCHandle pinned = GCHandle.Alloc(data, GCHandleType.Pinned);
                    try
                    {
                        IntPtr start = pinned.AddrOfPinnedObject();
                        int offset = 0;
                        while (offset < data.Length)
                        {
                            int written;
                            if (!WritePrinter(handle, IntPtr.Add(start, offset), data.Length - offset, out written)) throw Fail("WritePrinter");
                            if (written <= 0) throw new Exception("WritePrinter: la impresora no aceptó los datos");
                            offset += written;
                        }
                    }
                    finally { pinned.Free(); }
                }
                finally { EndPagePrinter(handle); }
            }
            finally { EndDocPrinter(handle); }
        }
        finally { ClosePrinter(handle); }
    }
}
'@
  $bytes = [System.IO.File]::ReadAllBytes($path)
  [MunchMateRawPrinter]::Send($printer, $bytes, $docName)
  exit 0
} catch {
  # PowerShell wraps .NET errors ("Exception calling Send with 3 arguments: ..."): report the innermost one.
  $failure = $_.Exception
  while ($failure.InnerException) { $failure = $failure.InnerException }
  [Console]::Error.WriteLine($failure.Message)
  exit 1
}
`;

/** Arguments of powershell.exe to run the RAW script (exported for tests: no value is interpolated in code). */
export function rawPrintArgs(scriptPath: string, printer: string, dataPath: string, docName: string): string[] {
  const b64 = (value: string) => Buffer.from(value, "utf8").toString("base64");
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-PrinterB64",
    b64(printer),
    "-PathB64",
    b64(dataPath),
    "-DocNameB64",
    b64(docName),
  ];
}

export const RAW_PRINT_TIMEOUT_MS = 30_000;

/** Message for the owner from a failed PowerShell run. */
export function rawPrintError(printer: string, error: ExecError): Error {
  if (error.killed || error.signal) {
    return new Error(`La impresora "${printer}" no respondió en ${RAW_PRINT_TIMEOUT_MS / 1000} s (revisa que esté encendida y conectada)`);
  }
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Error("No se encontró PowerShell en este equipo");
  const detail = (error.stderr ?? "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  const exit = typeof error.code === "number" ? ` (código ${error.code})` : "";
  return new Error(`Windows no pudo imprimir en "${printer}"${detail ? `: ${detail}` : exit}`);
}

/**
 * Writes the RAW script once per process into the agent's directory (private to the user, unlike a shared
 * temp folder) and returns a function that prints bytes on a Windows printer.
 */
export function createRawPrinter(options: { scriptDir: string; exec?: ExecFile; env?: NodeJS.ProcessEnv }) {
  const exec = options.exec ?? execFileAsync;
  const env = options.env ?? process.env;
  let scriptPath: Promise<string> | null = null;
  const ensureScript = () => {
    scriptPath ??= (async () => {
      await fs.mkdir(options.scriptDir, { recursive: true });
      const path = join(options.scriptDir, "raw-print.ps1");
      // UTF-8 with BOM: Windows PowerShell 5.1 reads BOM-less scripts in the ANSI code page.
      await fs.writeFile(path, `\uFEFF${RAW_PRINT_SCRIPT}`, "utf8");
      return path;
    })().catch((error: unknown) => {
      scriptPath = null;
      throw error;
    });
    return scriptPath;
  };

  return async (printer: string, data: Buffer, docName: string): Promise<void> => {
    const script = await ensureScript();
    const dataPath = join(tmpdir(), `munchmate-print-${randomBytes(8).toString("hex")}.bin`);
    await fs.writeFile(dataPath, data);
    try {
      await exec(powershellPath(env), rawPrintArgs(script, printer, dataPath, docName), {
        timeout: RAW_PRINT_TIMEOUT_MS,
        windowsHide: true,
      });
    } catch (error) {
      throw rawPrintError(printer, error as ExecError);
    } finally {
      await fs.rm(dataPath, { force: true }).catch(() => undefined);
    }
  };
}
