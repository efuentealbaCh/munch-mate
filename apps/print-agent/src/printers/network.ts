import { Socket } from "node:net";

/** Network receipt printers listen for raw ESC/POS on TCP 9100 ("JetDirect"/"RAW" port). */

export const NETWORK_TIMEOUT_MS = 10_000;

/** Key of a network printer as reported to the server ("net:192.168.1.50:9100"). */
export const networkPrinterKey = (host: string, port: number) => `net:${host}:${port}`;

/** Message for the owner from a socket error. */
export function networkError(name: string, host: string, port: number, error: NodeJS.ErrnoException | null): Error {
  const where = `"${name}" (${host}:${port})`;
  switch (error?.code) {
    case "ECONNREFUSED":
      return new Error(`La impresora ${where} rechazó la conexión: revisa la IP y que el puerto sea el ${port}`);
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "EHOSTDOWN":
      return new Error(`No se encontró la impresora ${where} en la red: revisa que esté encendida y conectada`);
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return new Error(`No se pudo resolver la dirección de la impresora ${where}`);
    case "ECONNRESET":
    case "EPIPE":
      return new Error(`La impresora ${where} cortó la conexión mientras imprimía`);
    case undefined:
      return new Error(`La impresora ${where} no respondió en ${NETWORK_TIMEOUT_MS / 1000} s: revisa que esté encendida y en la misma red`);
    default:
      return new Error(`No se pudo imprimir en ${where}: ${error?.message ?? "error desconocido"}`);
  }
}

/**
 * Sends raw bytes to a network printer: connect, write, half-close, and wait until the printer closes the
 * connection (or the socket finishes flushing). `timeoutMs` covers both the connection and any silence.
 */
export function sendToNetworkPrinter(
  printer: { name: string; host: string; port: number },
  data: Buffer,
  timeoutMs = NETWORK_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    // Covers the connection (setTimeout on the socket only measures inactivity after connecting).
    const timer = setTimeout(() => finish(networkError(printer.name, printer.host, printer.port, null)), timeoutMs);
    socket.setTimeout(timeoutMs, () => finish(networkError(printer.name, printer.host, printer.port, null)));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(networkError(printer.name, printer.host, printer.port, error)));
    // Printers often never answer: once everything is written and our side is closed, it is done.
    socket.once("close", (hadError) => {
      if (!hadError) finish(null);
    });
    socket.connect({ host: printer.host, port: printer.port }, () => {
      clearTimeout(timer);
      socket.end(data, () => {
        // All bytes handed to the OS; the printer may keep the connection open, give it a moment then close.
        setTimeout(() => finish(null), 200);
      });
    });
  });
}
