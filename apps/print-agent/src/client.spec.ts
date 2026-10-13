import { createServer, type Server as HttpServer } from "node:http";
import {
  type AgentAck,
  type AgentHelloInput,
  type AgentHelloResult,
  PRINT_AGENT_NAMESPACE,
  PRINT_AGENT_UNAUTHORIZED,
  type PrintAgentClientToServerEvents,
  type PrintAgentServerToClientEvents,
  type PrintJobPayload,
  type PrintResultInput,
  type ReportedPrinter,
} from "@app/types";
import { Server, type Socket as ServerSocket } from "socket.io";
import { AgentClient, type RevokedReason } from "./client";
import { silentLogger } from "./logger";
import type { LocalPrinter } from "./printers/types";

type AgentServerSocket = ServerSocket<PrintAgentClientToServerEvents, PrintAgentServerToClientEvents>;

const TOKEN = "device-token";
const JOB_ID = "65a1b2c3d4e5f60718293a4b";

const job = (overrides: Partial<PrintJobPayload> = {}): PrintJobPayload => ({
  jobId: JOB_ID,
  printerKey: "usb:Cocina",
  paper: "80",
  copies: 1,
  kind: "kitchen",
  layout: { columns: 48, lines: [{ text: "#7", align: "center", bold: true, size: 2 }], cut: true },
  queuedAt: new Date().toISOString(),
  ...overrides,
});

const waitFor = async (condition: () => boolean, timeoutMs = 4_000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** A Socket.IO server with the agent namespace, like the api's gateway (token check in a middleware). */
function fakeServer() {
  const http: HttpServer = createServer();
  const io = new Server(http);
  const namespace = io.of(PRINT_AGENT_NAMESPACE);
  const state = {
    acceptToken: true,
    hellos: [] as AgentHelloInput[],
    helloResult: { ok: true, agentId: "a1", agentName: "Cocina", restaurantName: "Trattoria", printers: [] } as AgentHelloResult,
    results: [] as PrintResultInput[],
    /** How many results to receive without acknowledging them (the agent must send them again). */
    dropAcks: 0,
    resultAck: { ok: true } as AgentAck,
    sockets: [] as AgentServerSocket[],
    connections: 0,
  };
  namespace.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: string }).token;
    next(state.acceptToken && token === TOKEN ? undefined : new Error(PRINT_AGENT_UNAUTHORIZED));
  });
  namespace.on("connection", (socket: AgentServerSocket) => {
    state.connections++;
    state.sockets.push(socket);
    socket.on("agent.hello", (input, ack) => {
      state.hellos.push(input);
      ack(state.helloResult);
    });
    socket.on("print.result", (input, ack) => {
      state.results.push(input);
      if (state.dropAcks > 0) {
        state.dropAcks--;
        return;
      }
      ack(state.resultAck);
    });
  });
  return {
    state,
    namespace,
    url: () => `http://127.0.0.1:${(http.address() as { port: number }).port}`,
    listen: () => new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve)),
    close: () => new Promise<void>((resolve) => io.close(() => resolve())),
  };
}

function fakePrinters(keys = ["usb:Cocina"]) {
  const printed: string[] = [];
  const printers = keys.map<LocalPrinter>((key) => ({
    key,
    name: key.slice(4),
    kind: "usb",
    send: async (data) => {
      printed.push(`${key}:${data.length}`);
    },
  }));
  let list: ReportedPrinter[] = printers.map(({ key, name, kind }) => ({ key, name, kind }));
  let changed = false;
  return {
    printed,
    lookup: {
      find: (key: string) => printers.find((printer) => printer.key === key),
      refresh: jest.fn(async () => {
        const result = changed;
        changed = false;
        return result;
      }),
      reported: () => list,
    },
    setReported: (next: ReportedPrinter[]) => {
      list = next;
      changed = true;
    },
  };
}

describe("AgentClient", () => {
  let server: ReturnType<typeof fakeServer>;
  let client: AgentClient | null = null;

  beforeEach(async () => {
    server = fakeServer();
    await server.listen();
  });

  afterEach(async () => {
    await client?.stop(100);
    client = null;
    await server.close();
  });

  function start(options: { printers?: ReturnType<typeof fakePrinters>; token?: string; rescanMs?: number; ackTimeoutMs?: number } = {}) {
    const printers = options.printers ?? fakePrinters();
    const revoked: RevokedReason[] = [];
    client = new AgentClient({
      serverUrl: server.url(),
      token: options.token ?? TOKEN,
      appVersion: "0.1.0",
      printers: printers.lookup,
      logger: silentLogger,
      onRevoked: (reason) => revoked.push(reason),
      reconnectDelayMs: 20,
      reconnectDelayMaxMs: 50,
      rescanMs: options.rescanMs ?? 60_000,
      ackTimeoutMs: options.ackTimeoutMs ?? 2_000,
    });
    client.start();
    return { client, printers, revoked };
  }

  it("says hello with its printers and keeps the owner's settings", async () => {
    server.state.helloResult = {
      ok: true,
      agentId: "a1",
      agentName: "Cocina",
      restaurantName: "Trattoria",
      printers: [{ key: "usb:Cocina", name: "Cocina", kind: "usb", enabled: true, paper: "58", kitchen: "new", categoryIds: [], receipts: false, copies: 1, reported: true }],
    };
    const { client } = start();
    await waitFor(() => client.restaurantName === "Trattoria");
    expect(server.state.hellos).toEqual([{ appVersion: "0.1.0", printers: [{ key: "usb:Cocina", name: "Cocina", kind: "usb" }] }]);
    expect(client.settings.get("usb:Cocina")?.paper).toBe("58");

    server.namespace.emit("agent.config", { agentName: "Cocina 2", printers: [] });
    await waitFor(() => client.agentName === "Cocina 2");
    expect(client.settings.size).toBe(0);
  });

  it("prints a job, confirms it, and confirms a re-sent copy without printing it twice", async () => {
    const { printers } = start();
    await waitFor(() => server.state.hellos.length === 1);
    server.namespace.emit("print.job", job());
    await waitFor(() => server.state.results.length === 1);
    expect(server.state.results[0]).toEqual({ jobId: JOB_ID, ok: true });
    server.namespace.emit("print.job", job());
    await waitFor(() => server.state.results.length === 2);
    expect(printers.printed).toHaveLength(1);
    expect(client?.pendingResults).toBe(0);
  });

  it("reports a printer that is not on this computer", async () => {
    start();
    await waitFor(() => server.state.hellos.length === 1);
    server.namespace.emit("print.job", job({ printerKey: "net:10.0.0.9:9100" }));
    await waitFor(() => server.state.results.length === 1);
    expect(server.state.results[0]).toEqual({ jobId: JOB_ID, ok: false, error: "Impresora no encontrada en este equipo" });
  });

  it("sends a result again until the server acknowledges it", async () => {
    server.state.dropAcks = 1;
    const { client } = start({ ackTimeoutMs: 150 });
    await waitFor(() => server.state.hellos.length === 1);
    server.namespace.emit("print.job", job());
    await waitFor(() => server.state.results.length === 2);
    await waitFor(() => client.pendingResults === 0);
    expect(server.state.results).toEqual([
      { jobId: JOB_ID, ok: true },
      { jobId: JOB_ID, ok: true },
    ]);
  });

  it("keeps results while disconnected and sends them after reconnecting", async () => {
    server.state.dropAcks = 1;
    const { client } = start({ ackTimeoutMs: 300 });
    await waitFor(() => server.state.hellos.length === 1);
    server.namespace.emit("print.job", job());
    await waitFor(() => server.state.results.length === 1);
    // The server drops the connection before acknowledging: socket.io does not reconnect by itself here.
    server.state.sockets[0]?.disconnect(true);
    await waitFor(() => server.state.connections === 2);
    await waitFor(() => client.pendingResults === 0);
    expect(server.state.hellos).toHaveLength(2);
    expect(server.state.results.length).toBeGreaterThanOrEqual(2);
  });

  it("says hello again when its printers change", async () => {
    const printers = fakePrinters();
    start({ printers, rescanMs: 50 });
    await waitFor(() => server.state.hellos.length === 1);
    printers.setReported([{ key: "net:10.0.0.2:9100", name: "Barra", kind: "network" }]);
    await waitFor(() => server.state.hellos.length === 2);
    expect(server.state.hellos[1]?.printers).toEqual([{ key: "net:10.0.0.2:9100", name: "Barra", kind: "network" }]);
  });

  it("gives up after the server rejects the token 3 times in a row", async () => {
    server.state.acceptToken = false;
    const { revoked, client } = start();
    await waitFor(() => revoked.length > 0);
    expect(revoked).toEqual(["unauthorized"]);
    expect(client.connected).toBe(false);
  });

  it("stops when the owner revokes it", async () => {
    const { revoked } = start();
    await waitFor(() => server.state.hellos.length === 1);
    server.namespace.emit("agent.revoked");
    await waitFor(() => revoked.length > 0);
    expect(revoked).toEqual(["revoked"]);
  });

  it("stops when the hello says the agent was revoked", async () => {
    server.state.helloResult = { ok: false, code: "AGENT_REVOKED" };
    const { revoked } = start();
    await waitFor(() => revoked.length > 0);
    expect(revoked).toEqual(["revoked"]);
  });
});
