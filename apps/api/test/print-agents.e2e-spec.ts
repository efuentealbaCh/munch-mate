import { randomUUID } from "node:crypto";
import {
  type AgentHelloResult,
  PRINT_AGENT_NAMESPACE,
  PRINT_AGENT_UNAUTHORIZED,
  type PairingCodeView,
  type PairPrintAgentResult,
  type PrintAgentClientToServerEvents,
  type PrintAgentServerToClientEvents,
  type PrintAgentsList,
  type PrintJobPayload,
  type PrintJobView,
  type ProductView,
  type TableView,
} from "@app/types";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, TEST_APP_URL, type TestContext } from "./support/test-app";

type AgentSocket = Socket<PrintAgentServerToClientEvents, PrintAgentClientToServerEvents>;

/**
 * Print agents end to end: pairing with a one-time code, the agent's Socket.IO namespace authenticated by
 * its device token, a kitchen ticket printed for a new order, and unpairing.
 */
describe("Print agents (e2e)", () => {
  let ctx: TestContext;
  let f: ReturnType<typeof fixtures>;
  const sockets: AgentSocket[] = [];

  beforeAll(async () => {
    ctx = await createTestApp({ listen: true });
    f = fixtures(ctx);
  });

  beforeEach(async () => {
    await resetRateLimits(ctx.valkeyUrl);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /** Connects like the agent does: no Origin header (native program), token in the handshake auth. */
  function agentSocket(token: string, extraHeaders: Record<string, string> = {}): AgentSocket {
    const socket: AgentSocket = io(`${ctx.baseUrl}${PRINT_AGENT_NAMESPACE}`, {
      transports: ["websocket"],
      auth: { token },
      extraHeaders,
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  }

  const connected = (socket: AgentSocket) =>
    new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });

  const next = <E extends keyof PrintAgentServerToClientEvents>(socket: AgentSocket, event: E) =>
    new Promise<Parameters<PrintAgentServerToClientEvents[E]>[0]>((resolve) => {
      socket.once(event as "print.job", ((payload: unknown) => resolve(payload as never)) as never);
    });

  /** Open restaurant with a product and a table, and an agent paired to it. */
  async function setup() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Trattoria Impresa");
    const base = `/api/restaurants/${restaurant.id}`;
    const category = (await owner.agent.post(`${base}/menu/categories`).send({ name: "Pastas" }).expect(201)).body;
    const pasta = (
      await owner.agent.post(`${base}/menu/products`).send({ categoryId: category.id, name: "Lasaña", price: 10000 }).expect(201)
    ).body as ProductView;
    const table = (await owner.agent.post(`${base}/tables`).send({ label: "Mesa 9" }).expect(201)).body as TableView;
    await owner.agent.put(`${base}/accepting-orders`).send({ acceptingOrders: true }).expect(200);

    const { code } = (await owner.agent.post(`${base}/print-agents/pairing-code`).expect(201)).body as PairingCodeView;
    const paired = (
      await request(f.server).post("/api/print-agents/pair").send({ code, name: "PC Cocina", appVersion: "1.0.0" }).expect(201)
    ).body as PairPrintAgentResult;
    return { owner, restaurant, base, pasta, table, code, paired };
  }

  it("pairs, connects, prints a new order's kitchen ticket and records the result", async () => {
    const s = await setup();
    expect(s.paired).toMatchObject({ restaurantName: "Trattoria Impresa" });
    // The code is single use.
    const reused = await request(f.server).post("/api/print-agents/pair").send({ code: s.code, name: "Otro", appVersion: "1" }).expect(400);
    expect(reused.body.code).toBe("INVALID_PAIRING_CODE");

    const socket = agentSocket(s.paired.token);
    await connected(socket);
    const hello = (await socket.emitWithAck("agent.hello", {
      appVersion: "1.0.1",
      printers: [{ key: "usb:EPSON TM-T20", name: "EPSON TM-T20", kind: "usb" }],
    })) as AgentHelloResult;
    expect(hello).toMatchObject({
      ok: true,
      agentId: s.paired.agentId,
      agentName: "PC Cocina",
      restaurantName: "Trattoria Impresa",
      printers: [{ key: "usb:EPSON TM-T20", enabled: false, paper: "80", kitchen: "off", reported: true }],
    });

    // The owner turns the printer on for new orders; the agent hears about it.
    const config = next(socket, "agent.config");
    await s.owner.agent
      .patch(`${s.base}/print-agents/${s.paired.agentId}/printers/${encodeURIComponent("usb:EPSON TM-T20")}`)
      .send({ enabled: true, kitchen: "new", paper: "58" })
      .expect(200);
    expect((await config).printers[0]).toMatchObject({ enabled: true, kitchen: "new", paper: "58" });

    const list = (await s.owner.agent.get(`${s.base}/print-agents`).expect(200)).body as PrintAgentsList;
    expect(list.agents).toEqual([expect.objectContaining({ id: s.paired.agentId, online: true, appVersion: "1.0.1" })]);
    expect((await s.owner.agent.get(`${s.base}/print-agents/summary`).expect(200)).body).toEqual({
      autoKitchen: true,
      receipts: false,
      online: true,
      offline: false,
    });

    const job = next(socket, "print.job");
    await request(f.server)
      .post(`/api/public/tables/${s.table.token}/orders`)
      .send({ clientOrderId: randomUUID(), items: [{ productId: s.pasta.id, quantity: 2, modifiers: [] }] })
      .expect(201);
    const payload = (await job) as PrintJobPayload;
    expect(payload).toMatchObject({ printerKey: "usb:EPSON TM-T20", paper: "58", kind: "kitchen", copies: 1, layout: { columns: 32, cut: true } });
    expect(payload.layout.lines.map((l) => l.text)).toContain("2 x Lasaña");
    expect(payload.layout.lines.every((l) => Array.from(l.text).length <= 32 / l.size)).toBe(true);

    expect(await socket.emitWithAck("print.result", { jobId: payload.jobId, ok: true })).toEqual({ ok: true });
    const printed = (await s.owner.agent.get(`${s.base}/print-agents/jobs`).query({ status: "printed" }).expect(200)).body as PrintJobView[];
    expect(printed).toEqual([expect.objectContaining({ id: payload.jobId, status: "printed", label: expect.stringMatching(/^Comanda #/) })]);
  });

  it("keeps a printer the agent stops reporting, routes nothing to it, and lets the owner remove it", async () => {
    const s = await setup();
    const key = encodeURIComponent("usb:EPSON TM-T20");
    const socket = agentSocket(s.paired.token);
    await connected(socket);
    await socket.emitWithAck("agent.hello", { appVersion: "1", printers: [{ key: "usb:EPSON TM-T20", name: "EPSON TM-T20", kind: "usb" }] });
    await s.owner.agent
      .patch(`${s.base}/print-agents/${s.paired.agentId}/printers/${key}`)
      .send({ enabled: true, kitchen: "new", paper: "58" })
      .expect(200);

    // Restarted with the printer unplugged: it stays, with its settings, as not reported.
    const unplugged = (await socket.emitWithAck("agent.hello", { appVersion: "1", printers: [] })) as AgentHelloResult;
    expect(unplugged).toMatchObject({ ok: true, printers: [{ key: "usb:EPSON TM-T20", enabled: true, kitchen: "new", paper: "58", reported: false }] });
    expect((await s.owner.agent.get(`${s.base}/print-agents/summary`).expect(200)).body).toMatchObject({ autoKitchen: false });

    // No job for it while it is not reported.
    await request(f.server)
      .post(`/api/public/tables/${s.table.token}/orders`)
      .send({ clientOrderId: randomUUID(), items: [{ productId: s.pasta.id, quantity: 1, modifiers: [] }] })
      .expect(201);
    expect((await s.owner.agent.get(`${s.base}/print-agents/jobs`).expect(200)).body).toEqual([]);

    // Plugged in again: everything is back.
    const back = (await socket.emitWithAck("agent.hello", {
      appVersion: "1",
      printers: [{ key: "usb:EPSON TM-T20", name: "EPSON TM-T20", kind: "usb" }],
    })) as AgentHelloResult;
    expect(back).toMatchObject({ ok: true, printers: [{ enabled: true, kitchen: "new", paper: "58", reported: true }] });

    // The owner removes it; reported again, it returns disabled with the defaults.
    const config = next(socket, "agent.config");
    const removed = (await s.owner.agent.delete(`${s.base}/print-agents/${s.paired.agentId}/printers/${key}`).expect(200)).body;
    expect(removed.printers).toEqual([]);
    expect((await config).printers).toEqual([]);
    expect((await s.owner.agent.delete(`${s.base}/print-agents/${s.paired.agentId}/printers/${key}`).expect(404)).body.code).toBe(
      "PRINTER_NOT_FOUND",
    );
    const again = (await socket.emitWithAck("agent.hello", {
      appVersion: "1",
      printers: [{ key: "usb:EPSON TM-T20", name: "EPSON TM-T20", kind: "usb" }],
    })) as AgentHelloResult;
    expect(again).toMatchObject({ ok: true, printers: [{ enabled: false, kitchen: "off", paper: "80", reported: true }] });
  });

  it("rejects unknown and revoked tokens, and browsers of other origins", async () => {
    const s = await setup();

    await expect(connected(agentSocket("x".repeat(43)))).rejects.toMatchObject({ message: PRINT_AGENT_UNAUTHORIZED });
    // A browser page of another site is rejected by the Origin check, even holding a valid token.
    await expect(connected(agentSocket(s.paired.token, { origin: "https://evil.example" }))).rejects.toBeDefined();
    // The app's own origin is fine (the web could host a diagnostics page some day).
    await connected(agentSocket(s.paired.token, { origin: TEST_APP_URL }));

    const socket = agentSocket(s.paired.token);
    await connected(socket);
    const revoked = next(socket, "agent.revoked");
    const closed = new Promise<void>((resolve) => socket.once("disconnect", () => resolve()));
    await s.owner.agent.delete(`${s.base}/print-agents/${s.paired.agentId}`).expect(204);
    await revoked;
    await closed;

    await expect(connected(agentSocket(s.paired.token))).rejects.toMatchObject({ message: PRINT_AGENT_UNAUTHORIZED });
    expect(((await s.owner.agent.get(`${s.base}/print-agents`).expect(200)).body as PrintAgentsList).agents).toEqual([]);
  });

  it("keeps the routes to the owner (summary for the board) and other tenants out", async () => {
    const s = await setup();
    const cook = await f.staff(s.owner.agent, s.restaurant.id, ["kitchen"]);
    await cook.agent.get(`${s.base}/print-agents/summary`).expect(200);
    expect((await cook.agent.get(`${s.base}/print-agents`).expect(403)).body.code).toBe("FORBIDDEN_ROLE");
    expect((await cook.agent.post(`${s.base}/print-agents/pairing-code`).expect(403)).body.code).toBe("FORBIDDEN_ROLE");

    const other = await f.ownerWithRestaurant("Otro Local");
    expect((await other.owner.agent.get(`${s.base}/print-agents`).expect(404)).body.code).toBe("RESTAURANT_NOT_FOUND");
    // Another restaurant's agent id is unknown here.
    expect(
      (await other.owner.agent.patch(`/api/restaurants/${other.restaurant.id}/print-agents/${s.paired.agentId}`).send({ name: "x" }).expect(404))
        .body.code,
    ).toBe("PRINT_AGENT_NOT_FOUND");
    await request(f.server).get(`${s.base}/print-agents`).expect(401);
  });
});
