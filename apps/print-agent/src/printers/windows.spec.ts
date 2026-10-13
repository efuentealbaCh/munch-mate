import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger } from "../logger";
import { PrinterRegistry } from "./registry";
import type { ExecError, ExecFile } from "./types";
import {
  RAW_PRINT_SCRIPT,
  createRawPrinter,
  isVirtualPrinter,
  listWindowsPrinters,
  parseWin32Printers,
  powershellPath,
  rawPrintArgs,
  rawPrintError,
  usbPrinterKey,
} from "./windows";

describe("parseWin32Printers", () => {
  it("reads an array (several printers)", () => {
    const out = JSON.stringify([
      { Name: "EPSON TM-T20II", PortName: "USB001", WorkOffline: false },
      { Name: "Cocina", PortName: "IP_192.168.1.50", WorkOffline: true },
    ]);
    expect(parseWin32Printers(out)).toEqual([
      { name: "EPSON TM-T20II", portName: "USB001", workOffline: false },
      { name: "Cocina", portName: "IP_192.168.1.50", workOffline: true },
    ]);
  });

  it("reads a single object (PowerShell does not wrap one printer in an array)", () => {
    expect(parseWin32Printers('{"Name":"POS-80","PortName":"USB002","WorkOffline":false}\r\n')).toEqual([
      { name: "POS-80", portName: "USB002", workOffline: false },
    ]);
  });

  it("reads empty output (no printers) and skips entries without a name", () => {
    expect(parseWin32Printers("")).toEqual([]);
    expect(parseWin32Printers("  \r\n")).toEqual([]);
    expect(parseWin32Printers('[{"Name":null},{"PortName":"x"},{"Name":"Ñandú","PortName":null}]')).toEqual([
      { name: "Ñandú", portName: "", workOffline: false },
    ]);
  });

  it("throws on output that is not JSON", () => {
    expect(() => parseWin32Printers("Get-CimInstance : Acceso denegado")).toThrow();
  });
});

describe("isVirtualPrinter", () => {
  it.each([
    [{ name: "Microsoft Print to PDF", portName: "PORTPROMPT:" }, true],
    [{ name: "Microsoft XPS Document Writer", portName: "PORTPROMPT:" }, true],
    [{ name: "OneNote (Desktop)", portName: "nul:" }, true],
    [{ name: "Fax", portName: "SHRFAX:" }, true],
    [{ name: "Snagit 2024", portName: "C:\\ProgramData\\TechSmith\\Snagit 24\\PrinterPortFile" }, true],
    [{ name: "EPSON TM-T20II", portName: "USB001" }, false],
    [{ name: "Cocina", portName: "192.168.1.50" }, false],
  ])("%p → %p", (printer, expected) => {
    expect(isVirtualPrinter({ ...printer, workOffline: false })).toBe(expected);
  });
});

describe("listWindowsPrinters", () => {
  it("runs PowerShell by absolute path, hidden, and drops virtual printers", async () => {
    const exec = jest.fn<ReturnType<ExecFile>, Parameters<ExecFile>>(async () => ({
      stdout: JSON.stringify([
        { Name: "Microsoft Print to PDF", PortName: "PORTPROMPT:", WorkOffline: false },
        { Name: "EPSON TM-T20II", PortName: "USB001", WorkOffline: false },
      ]),
      stderr: "",
    }));
    await expect(listWindowsPrinters(exec, { SystemRoot: "C:\\Windows" })).resolves.toEqual([
      { name: "EPSON TM-T20II", portName: "USB001", workOffline: false },
    ]);
    const [file, args, options] = exec.mock.calls[0]!;
    expect(file).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(args.slice(0, 4)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]);
    expect(options).toMatchObject({ windowsHide: true, timeout: 30_000 });
  });
});

describe("RAW printing", () => {
  const scriptDir = () => mkdtempSync(join(tmpdir(), "mm-raw-"));

  it("passes every value base64-encoded, never inside the script", () => {
    const printer = 'Cocina "1"; Remove-Item C:\\ -Recurse';
    const args = rawPrintArgs("C:\\Users\\José\\raw-print.ps1", printer, "C:\\Temp\\a b.bin", "Munch Mate 1");
    expect(args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\Users\\José\\raw-print.ps1",
      "-PrinterB64",
      Buffer.from(printer, "utf8").toString("base64"),
      "-PathB64",
      Buffer.from("C:\\Temp\\a b.bin", "utf8").toString("base64"),
      "-DocNameB64",
      Buffer.from("Munch Mate 1", "utf8").toString("base64"),
    ]);
    expect(RAW_PRINT_SCRIPT).toContain('pDatatype = "RAW"');
    expect(RAW_PRINT_SCRIPT).not.toContain("${");
  });

  it("writes the script with a BOM, sends the bytes through a temporary file and deletes it", async () => {
    const dir = scriptDir();
    let seen: { path: string; data: Buffer } | null = null;
    const exec: ExecFile = async (_file, args) => {
      const path = Buffer.from(args[args.indexOf("-PathB64") + 1]!, "base64").toString("utf8");
      seen = { path, data: readFileSync(path) };
      return { stdout: "", stderr: "" };
    };
    try {
      const send = createRawPrinter({ scriptDir: dir, exec, env: { SystemRoot: "C:\\Windows" } });
      await send("EPSON", Buffer.from([0x1b, 0x40]), "Munch Mate 1");
      expect(seen!.data).toEqual(Buffer.from([0x1b, 0x40]));
      expect(() => readFileSync(seen!.path)).toThrow();
      const script = readFileSync(join(dir, "raw-print.ps1"));
      expect([...script.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("propagates the error of PowerShell and still deletes the temporary file", async () => {
    const dir = scriptDir();
    let path = "";
    const exec: ExecFile = async (_file, args) => {
      path = Buffer.from(args[args.indexOf("-PathB64") + 1]!, "base64").toString("utf8");
      const error = new Error("Command failed") as ExecError;
      error.code = 1;
      error.stderr = "OpenPrinter: El nombre de la impresora no es válido\r\n";
      throw error;
    };
    try {
      const send = createRawPrinter({ scriptDir: dir, exec });
      await expect(send("Nada", Buffer.from("x"), "doc")).rejects.toThrow('Windows no pudo imprimir en "Nada": OpenPrinter: El nombre de la impresora no es válido');
      expect(() => readFileSync(path)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explains timeouts and exit codes without output", () => {
    const timeout = Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" }) as ExecError;
    expect(rawPrintError("EPSON", timeout).message).toContain("no respondió en 30 s");
    const exit = Object.assign(new Error("failed"), { code: 3, stderr: "" }) as ExecError;
    expect(rawPrintError("EPSON", exit).message).toBe('Windows no pudo imprimir en "EPSON" (código 3)');
  });

  it("finds PowerShell under SystemRoot", () => {
    expect(powershellPath({ SystemRoot: "D:\\WINDOWS" })).toBe("D:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });
});

describe("PrinterRegistry", () => {
  const registry = (usb: { name: string }[], platform: NodeJS.Platform = "win32", env: NodeJS.ProcessEnv = {}) => {
    const sendRaw = jest.fn(async () => undefined);
    const printers = new PrinterRegistry({ home: tmpdir(), logger: silentLogger, platform, env, listUsb: async () => usb, sendRaw });
    return { printers, sendRaw };
  };

  it("reports network printers first, then Windows ones, with server-safe keys", async () => {
    const { printers, sendRaw } = registry([{ name: "  EPSON\u200b TM-T20 " }]);
    printers.setNetworkPrinters([{ name: "Barra", host: "192.168.1.60", port: 9100 }]);
    expect(await printers.refresh()).toBe(true);
    expect(printers.reported()).toEqual([
      { key: "net:192.168.1.60:9100", name: "Barra", kind: "network" },
      { key: "usb:EPSON TM-T20", name: "EPSON TM-T20", kind: "usb" },
    ]);
    expect(await printers.refresh()).toBe(false);
    // The spooler gets the raw Windows name.
    await printers.find("usb:EPSON TM-T20")!.send(Buffer.from("x"), "doc");
    expect(sendRaw).toHaveBeenCalledWith("  EPSON\u200b TM-T20 ", Buffer.from("x"), "doc");
    expect(usbPrinterKey("  EPSON\u200b TM-T20 ")).toBe("usb:EPSON TM-T20");
  });

  it("reports at most 20 printers, never dropping network ones", async () => {
    const usb = Array.from({ length: 25 }, (_, index) => ({ name: `USB ${index}` }));
    const { printers } = registry(usb);
    printers.setNetworkPrinters([{ name: "Barra", host: "10.0.0.2", port: 9100 }]);
    await printers.refresh();
    expect(printers.reported()).toHaveLength(20);
    expect(printers.reported()[0]?.kind).toBe("network");
  });

  it("skips Windows printers whose name is too long for the server", async () => {
    const { printers } = registry([{ name: "x".repeat(101) }, { name: "POS-58" }]);
    await printers.refresh();
    expect(printers.reported().map((printer) => printer.name)).toEqual(["POS-58"]);
  });

  it("only uses network printers outside Windows, plus the file printer when configured", async () => {
    const { printers } = registry([{ name: "EPSON" }], "linux", { MUNCHMATE_PRINT_DIR: "/tmp/tickets" });
    await printers.refresh();
    expect(printers.reported()).toEqual([{ key: "file:pruebas", name: "Archivo (pruebas)", kind: "usb" }]);
  });

  it("finds a printer by key or by name", async () => {
    const { printers } = registry([{ name: "EPSON TM-T20" }]);
    await printers.refresh();
    expect(printers.findByKeyOrName("usb:EPSON TM-T20")?.name).toBe("EPSON TM-T20");
    expect(printers.findByKeyOrName(" epson tm-t20 ")?.name).toBe("EPSON TM-T20");
    expect(printers.findByKeyOrName("Otra")).toBeUndefined();
  });

  it("keeps the previous list when PowerShell fails", async () => {
    let fail = false;
    const printers = new PrinterRegistry({
      home: tmpdir(),
      logger: silentLogger,
      platform: "win32",
      listUsb: async () => {
        if (fail) throw new Error("powershell bloqueado");
        return [{ name: "EPSON" }];
      },
      sendRaw: async () => undefined,
    });
    await printers.refresh();
    fail = true;
    expect(await printers.refresh()).toBe(false);
    expect(printers.reported()).toHaveLength(1);
  });
});
