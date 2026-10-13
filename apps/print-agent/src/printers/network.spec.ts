import { createServer, type Server } from "node:net";
import { networkError, networkPrinterKey, sendToNetworkPrinter } from "./network";

const listen = (server: Server) =>
  new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });

describe("network printers (TCP 9100)", () => {
  it("sends every byte and resolves when the printer closes", async () => {
    const received: Buffer[] = [];
    const server = createServer((socket) => {
      socket.on("data", (chunk) => received.push(chunk));
      socket.on("end", () => socket.end());
    });
    const port = await listen(server);
    try {
      const data = Buffer.alloc(100_000, 0x41);
      await sendToNetworkPrinter({ name: "Cocina", host: "127.0.0.1", port }, data);
      expect(Buffer.concat(received)).toEqual(data);
    } finally {
      server.close();
    }
  });

  it("resolves when the printer keeps the connection open after receiving", async () => {
    const received: Buffer[] = [];
    const server = createServer((socket) => socket.on("data", (chunk) => received.push(chunk)));
    const port = await listen(server);
    try {
      await sendToNetworkPrinter({ name: "Cocina", host: "127.0.0.1", port }, Buffer.from("hola"));
      expect(Buffer.concat(received).toString()).toBe("hola");
    } finally {
      server.close();
    }
  });

  it("explains a refused connection", async () => {
    const server = createServer();
    const port = await listen(server);
    await new Promise((resolve) => server.close(resolve));
    await expect(sendToNetworkPrinter({ name: "Cocina", host: "127.0.0.1", port }, Buffer.from("x"))).rejects.toThrow(
      `La impresora "Cocina" (127.0.0.1:${port}) rechazó la conexión`,
    );
  });

  it("times out when the printer does not answer", async () => {
    // A non-routable address: depending on the network it times out or fails at once; both are reported.
    await expect(sendToNetworkPrinter({ name: "Cocina", host: "10.255.255.1", port: 9100 }, Buffer.from("x"), 300)).rejects.toThrow(
      /no respondió|no se encontró|rechazó/,
    );
  });

  it("builds keys and messages", () => {
    expect(networkPrinterKey("192.168.1.50", 9100)).toBe("net:192.168.1.50:9100");
    const error = Object.assign(new Error("x"), { code: "EHOSTUNREACH" });
    expect(networkError("Barra", "10.0.0.2", 9100, error).message).toContain("No se encontró la impresora");
  });
});
