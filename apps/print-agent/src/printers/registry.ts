import { promises as fs } from "node:fs";
import { join } from "node:path";
import { PRINT_LIMITS, type ReportedPrinter } from "@app/types";
import type { NetworkPrinterConfig } from "../input";
import type { Logger } from "../logger";
import { cleanLabel, truncate } from "../text";
import { networkPrinterKey, sendToNetworkPrinter } from "./network";
import type { ExecFile, LocalPrinter } from "./types";
import { createRawPrinter, listWindowsPrinters, usbPrinterKey } from "./windows";

/** Key of the development "printer" that writes every job to a file (`MUNCHMATE_PRINT_DIR`). */
export const FILE_PRINTER_KEY = "file:pruebas";

export interface RegistryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Agent directory (the RAW print script is written there). */
  home: string;
  logger: Logger;
  exec?: ExecFile;
  /** Replaces the Windows listing (tests). */
  listUsb?: () => Promise<{ name: string }[]>;
  /** Replaces the RAW printing (tests). */
  sendRaw?: (printer: string, data: Buffer, docName: string) => Promise<void>;
}

/**
 * The printers this computer can use right now: configured network printers first (the owner added them on
 * purpose, they are never dropped by the limit), then Windows printers, then the optional file printer.
 * At most `PRINT_LIMITS.printersPerAgent`, with keys and names that the server accepts unchanged.
 */
export class PrinterRegistry {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly logger: Logger;
  private readonly listUsb: () => Promise<{ name: string }[]>;
  private readonly sendRaw: (printer: string, data: Buffer, docName: string) => Promise<void>;
  private network: NetworkPrinterConfig[] = [];
  private usb: { name: string }[] = [];
  private printers: LocalPrinter[] = [];
  /** Last warnings logged, so a rescan every minute does not repeat them. */
  private lastWarnings = "";

  constructor(options: RegistryOptions) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.logger = options.logger;
    this.listUsb = options.listUsb ?? (() => listWindowsPrinters(options.exec, this.env));
    this.sendRaw = options.sendRaw ?? createRawPrinter({ scriptDir: options.home, exec: options.exec, env: this.env });
  }

  /** Replaces the configured network printers (read from config.json). */
  setNetworkPrinters(printers: NetworkPrinterConfig[]): void {
    this.network = printers;
    this.rebuild();
  }

  /**
   * Scans the Windows printers again (Windows only). A failed scan keeps the previous list.
   * @returns Whether the reported list changed.
   */
  async refresh(): Promise<boolean> {
    const before = this.signature();
    if (this.platform === "win32") {
      try {
        this.usb = await this.listUsb();
      } catch (error) {
        this.logger.warn("No se pudieron listar las impresoras de Windows", { err: error });
      }
    }
    this.rebuild();
    return this.signature() !== before;
  }

  list(): LocalPrinter[] {
    return this.printers;
  }

  /** What `agent.hello` reports. */
  reported(): ReportedPrinter[] {
    return this.printers.map(({ key, name, kind }) => ({ key, name, kind }));
  }

  find(key: string): LocalPrinter | undefined {
    return this.printers.find((printer) => printer.key === key);
  }

  /** By key, or else by name (case and spaces aside): what the owner types in `--test`. */
  findByKeyOrName(text: string): LocalPrinter | undefined {
    const wanted = cleanLabel(text).toLowerCase();
    return this.find(text) ?? this.printers.find((printer) => printer.name.toLowerCase() === wanted || printer.key.toLowerCase() === wanted);
  }

  private signature(): string {
    return JSON.stringify(this.reported());
  }

  private rebuild(): void {
    const printers: LocalPrinter[] = [];
    const keys = new Set<string>();
    const warnings: string[] = [];
    const add = (printer: LocalPrinter) => {
      if (printers.length >= PRINT_LIMITS.printersPerAgent) {
        warnings.push(`Hay más de ${PRINT_LIMITS.printersPerAgent} impresoras; "${printer.name}" no se informa al servidor`);
        return;
      }
      if (printer.key.length > PRINT_LIMITS.printerKeyMax || keys.has(printer.key)) return;
      keys.add(printer.key);
      printers.push(printer);
    };

    for (const net of this.network) {
      add({
        key: networkPrinterKey(net.host, net.port),
        name: truncate(cleanLabel(net.name), PRINT_LIMITS.printerNameMax),
        kind: "network",
        send: (data) => sendToNetworkPrinter(net, data),
      });
    }
    for (const usb of this.usb) {
      const name = cleanLabel(usb.name);
      if (!name || name.length > PRINT_LIMITS.printerNameMax) {
        warnings.push(`La impresora "${usb.name}" tiene un nombre demasiado largo y no se informa al servidor`);
        continue;
      }
      // The raw Windows name (not the cleaned one) is what the spooler knows.
      add({ key: usbPrinterKey(usb.name), name, kind: "usb", send: (data, docName) => this.sendRaw(usb.name, data, docName) });
    }
    const dir = this.env.MUNCHMATE_PRINT_DIR;
    if (dir) {
      add({
        key: FILE_PRINTER_KEY,
        name: "Archivo (pruebas)",
        kind: "usb",
        send: async (data, docName) => {
          await fs.mkdir(dir, { recursive: true });
          const safe = docName.replace(/[^a-zA-Z0-9_-]+/g, "-");
          await fs.writeFile(join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${safe}.bin`), data);
        },
      });
    }
    this.printers = printers;
    const joined = warnings.join("\n");
    if (joined !== this.lastWarnings) for (const warning of warnings) this.logger.warn(warning);
    this.lastWarnings = joined;
  }
}
