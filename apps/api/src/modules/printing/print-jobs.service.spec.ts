import type { AgentPrinter, OrderView } from "@app/types";
import type { PinoLogger } from "nestjs-pino";
import type { CategoriesRepository } from "../menu/categories.repository";
import type { ProductsRepository } from "../menu/products.repository";
import type { RealtimeService } from "../realtime/realtime.service";
import type { RestaurantsRepository } from "../restaurants/restaurants.repository";
import type { PrintAgentRecord, PrintAgentsRepository } from "./print-agents.repository";
import type { PrintAgentsRealtime } from "./print-agents.realtime";
import type { NewPrintJob, PrintJobRecord, PrintJobsRepository } from "./print-jobs.repository";
import { PrintJobsService } from "./print-jobs.service";

const printer = (over: Partial<AgentPrinter> = {}): AgentPrinter => ({
  key: "usb:EPSON",
  name: "EPSON",
  kind: "usb",
  enabled: true,
  paper: "80",
  kitchen: "new",
  categoryIds: [],
  receipts: false,
  copies: 1,
  reported: true,
  ...over,
});

const agent =(printers: AgentPrinter[], id = "a1"): PrintAgentRecord => ({
  id,
  restaurantId: "r1",
  name: "Cocina",
  appVersion: "1.0.0",
  createdAt: new Date(),
  lastSeenAt: null,
  revokedAt: null,
  printers,
});

const order = (over: Partial<OrderView> = {}): OrderView =>
  ({
    id: "o1",
    number: 140,
    ticketNumber: 12,
    channel: "dine_in",
    status: "pending",
    tableLabel: "Mesa 4",
    customerName: "",
    createdAt: "2026-10-13T23:45:00.000Z",
    estimatedReadyAt: null,
    note: "",
    revision: 0,
    edits: [],
    subtotal: 11500,
    deliveryFee: 0,
    total: 11500,
    currency: "CLP",
    paymentStatus: "paid",
    items: [
      { productId: "pizza", name: "Margarita", unitPrice: 10000, regularUnitPrice: 10000, promoLabel: "", quantity: 1, note: "", lineTotal: 10000, modifiers: [] },
      { productId: "coke", name: "Coca-Cola", unitPrice: 1500, regularUnitPrice: 1500, promoLabel: "", quantity: 1, note: "", lineTotal: 1500, modifiers: [] },
    ],
    ...over,
  }) as unknown as OrderView;

/** In-memory print_jobs with the unique dedupe key. */
function fakeJobs(seed: PrintJobRecord[] = []) {
  const rows: PrintJobRecord[] = [...seed];
  let next = 1;
  const id = () => (next++).toString(16).padStart(24, "0");
  return {
    rows,
    insert: jest.fn(async (restaurantId: string, job: NewPrintJob) => {
      if (rows.some((r) => r.restaurantId === restaurantId && r.dedupeKey === job.dedupeKey)) return null;
      const record: PrintJobRecord = {
        ...job,
        id: id(),
        restaurantId,
        status: "queued",
        attempts: 0,
        error: null,
        queuedAt: new Date(),
        printedAt: null,
        createdAt: new Date(),
      };
      rows.push(record);
      return record;
    }),
    markSent: jest.fn(async (_r: string, jobId: string) => {
      const row = rows.find((r) => r.id === jobId);
      if (row && (row.status === "queued" || row.status === "sent")) {
        row.status = "sent";
        row.attempts++;
      }
    }),
    printersWithKitchenTicket: jest.fn(async (_r: string, orderId: string) =>
      rows
        .filter((r) => r.orderId === orderId && r.kind.startsWith("kitchen") && ["queued", "sent", "printed"].includes(r.status))
        .map((r) => ({ agentId: r.agentId, printerKey: r.printerKey })),
    ),
    expireStale: jest.fn(async (_r: string, agentId: string, cutoffs: { kitchen: Date; receipt: Date }, reason: string) => {
      const stale = rows.filter(
        (r) =>
          r.agentId === agentId &&
          (r.status === "queued" || r.status === "sent") &&
          r.queuedAt < (r.kind === "receipt" ? cutoffs.receipt : cutoffs.kitchen),
      );
      for (const row of stale) Object.assign(row, { status: "expired", error: reason });
      return stale;
    }),
    expire: jest.fn(async (_r: string, ids: string[], reason: string) => {
      for (const row of rows.filter((r) => ids.includes(r.id))) Object.assign(row, { status: "expired", error: reason });
    }),
    expireAllOf: jest.fn(async () => undefined),
    listPending: jest.fn(async (_r: string, agentId: string) =>
      rows.filter((r) => r.agentId === agentId && (r.status === "queued" || r.status === "sent")),
    ),
    setResult: jest.fn(async (_r: string, agentId: string, jobId: string, result: { ok: boolean; error?: string }) => {
      const row = rows.find((r) => r.id === jobId && r.agentId === agentId && r.status !== "printed");
      if (!row) return null;
      Object.assign(row, result.ok ? { status: "printed", printedAt: new Date() } : { status: "failed", error: result.error });
      return { ...row };
    }),
    findOne: jest.fn(async (_r: string, jobId: string) => rows.find((r) => r.id === jobId) ?? null),
    requeue: jest.fn(async (_r: string, jobId: string) => {
      const row = rows.find((r) => r.id === jobId && (r.status === "failed" || r.status === "expired"));
      if (!row) return null;
      Object.assign(row, { status: "queued", error: null, queuedAt: new Date() });
      return { ...row };
    }),
    list: jest.fn(async () => rows),
  };
}

function setup(
  options: { agents?: PrintAgentRecord[]; seed?: PrintJobRecord[]; failAgents?: boolean; categories?: string[] } = {},
) {
  const agents = options.agents ?? [agent([printer()])];
  const jobs = fakeJobs(options.seed);
  const sent: { agentId: string; event: string; payload: unknown }[] = [];
  const staff: { event: string; payload: unknown }[] = [];
  const logger = { warn: jest.fn() };
  const products = {
    list: jest.fn(async () => [
      { id: "pizza", categoryId: "c-food" },
      { id: "coke", categoryId: "c-drinks" },
    ]),
  };
  const categories = {
    list: jest.fn(async () => (options.categories ?? ["c-food", "c-drinks", "c-desserts"]).map((id) => ({ id }))),
  };
  const service = new PrintJobsService(
    jobs as unknown as PrintJobsRepository,
    {
      listActive: jest.fn(async () => {
        if (options.failAgents) throw new Error("mongo down");
        return agents;
      }),
      findActive: jest.fn(async (_r: string, id: string) => agents.find((a) => a.id === id) ?? null),
    } as unknown as PrintAgentsRepository,
    {
      toAgent: (agentId: string) => ({ emit: (event: string, payload: unknown) => sent.push({ agentId, event, payload }) }),
    } as unknown as PrintAgentsRealtime,
    { toRestaurant: () => ({ emit: (event: string, payload: unknown) => staff.push({ event, payload }) }) } as unknown as RealtimeService,
    { findById: jest.fn(async () => ({ id: "r1", name: "Forno Rosso", timezone: "America/Santiago", currency: "CLP" })) } as unknown as RestaurantsRepository,
    products as unknown as ProductsRepository,
    categories as unknown as CategoriesRepository,
    logger as unknown as PinoLogger,
  );
  return { service, jobs, sent, staff, logger, products };
}

describe("PrintJobsService kitchen tickets", () => {
  it("prints new orders only on printers with the rule 'new', and accepted ones on 'accepted'", async () => {
    const onNew = printer({ key: "usb:new", kitchen: "new" });
    const onAccept = printer({ key: "usb:acc", kitchen: "accepted" });
    const off = printer({ key: "usb:off", kitchen: "off" });
    const disabled = printer({ key: "usb:dis", kitchen: "new", enabled: false });
    // Enabled, but the agent did not report it in its last hello (unplugged): no jobs until it comes back.
    const unplugged = printer({ key: "usb:unplugged", kitchen: "new", reported: false });
    const { service, jobs, sent } = setup({ agents: [agent([onNew, onAccept, off, disabled, unplugged])] });

    await service.orderCreated("r1", order());
    expect(jobs.rows.map((j) => j.printerKey)).toEqual(["usb:new"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      agentId: "a1",
      event: "print.job",
      payload: { printerKey: "usb:new", paper: "80", copies: 1, kind: "kitchen", layout: { columns: 48, cut: true } },
    });
    expect(jobs.rows[0]).toMatchObject({ status: "sent", attempts: 1, dedupeKey: "kitchen:o1:a1:usb:new", label: "Comanda #12" });

    await service.orderAccepted("r1", order({ status: "accepted" }));
    expect(jobs.rows.map((j) => j.printerKey)).toEqual(["usb:new", "usb:acc"]);
  });

  it("does not print the same event twice (dedupe key)", async () => {
    const { service, jobs, sent } = setup();
    await service.orderCreated("r1", order());
    await service.orderCreated("r1", order());
    expect(jobs.rows).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("filters by category and skips printers left with nothing to print", async () => {
    const bar = printer({ key: "usb:bar", categoryIds: ["c-drinks"], paper: "58", copies: 2 });
    const desserts = printer({ key: "usb:postres", categoryIds: ["c-desserts"] });
    const { service, jobs, products } = setup({ agents: [agent([bar, desserts])] });

    await service.orderCreated("r1", order());

    expect(products.list).toHaveBeenCalledWith("r1");
    expect(jobs.rows).toHaveLength(1);
    const texts = jobs.rows[0]!.lines.map((l) => l.text);
    expect(texts).toContain("1 x Coca-Cola");
    expect(texts).not.toContain("1 x Margarita");
    expect(jobs.rows[0]).toMatchObject({ paper: "58", copies: 2 });
  });

  it("ignores deleted categories, and prints everything when none of the filter is left", async () => {
    const bar = printer({ key: "usb:bar", categoryIds: ["c-drinks", "c-gone"] });
    const orphan = printer({ key: "usb:orphan", categoryIds: ["c-gone"] });
    const { service, jobs } = setup({ agents: [agent([bar, orphan])], categories: ["c-food", "c-drinks"] });

    await service.orderCreated("r1", order());

    const textsOf = (key: string) => jobs.rows.find((r) => r.printerKey === key)!.lines.map((l) => l.text);
    expect(textsOf("usb:bar")).toContain("1 x Coca-Cola");
    expect(textsOf("usb:bar")).not.toContain("1 x Margarita");
    // Its only category was deleted from the menu: it prints the whole order instead of going silent.
    expect(textsOf("usb:orphan")).toEqual(expect.arrayContaining(["1 x Coca-Cola", "1 x Margarita"]));
  });

  it("prints MODIFICADO only on printers that already had a ticket of the order", async () => {
    const kitchen = printer({ key: "usb:cocina", kitchen: "accepted" });
    const bar = printer({ key: "usb:bar", kitchen: "accepted" });
    const { service, jobs } = setup({ agents: [agent([kitchen, bar])] });
    // Not printed anywhere yet: an edit prints nothing (the first ticket will show the current order).
    await service.orderEdited("r1", order({ revision: 1 }));
    expect(jobs.rows).toHaveLength(0);

    await service.orderAccepted("r1", order());
    jobs.rows.find((j) => j.printerKey === "usb:bar")!.status = "failed";
    jobs.rows.find((j) => j.printerKey === "usb:cocina")!.status = "printed";

    const edited = order({
      revision: 1,
      edits: [{ at: "2026-10-13T23:50:00.000Z", byName: "Ana", reason: null, changes: ["+1 Coca-Cola"] }],
    });
    await service.orderEdited("r1", edited);
    const editedJobs = jobs.rows.filter((j) => j.kind === "kitchen_edited");
    expect(editedJobs.map((j) => j.printerKey)).toEqual(["usb:cocina"]);
    expect(editedJobs[0]).toMatchObject({ dedupeKey: "kitchen:o1:r1:a1:usb:cocina", label: "Comanda modificada #12", orderRevision: 1 });
    expect(editedJobs[0]!.lines.map((l) => l.text)).toContain("MODIFICADO");
    // The same revision again does not print twice.
    await service.orderEdited("r1", edited);
    expect(jobs.rows.filter((j) => j.kind === "kitchen_edited")).toHaveLength(1);
  });

  it("prints an edit even when none of the printer's categories is left (the kitchen must drop its items)", async () => {
    const kitchen = printer({ key: "usb:cocina", categoryIds: ["c-food"] });
    const { service, jobs } = setup({ agents: [agent([kitchen])] });
    await service.orderCreated("r1", order());
    const onlyDrinks = order({
      revision: 1,
      items: [order().items[1]!],
      edits: [{ at: "2026-10-13T23:50:00.000Z", byName: "Ana", reason: null, changes: ["-1 Margarita"] }],
    });
    await service.orderEdited("r1", onlyDrinks);
    expect(jobs.rows.filter((j) => j.kind === "kitchen_edited")).toHaveLength(1);
  });

  it("reprints on demand on every kitchen printer, as a new event each time", async () => {
    const { service, jobs } = setup({ agents: [agent([printer({ kitchen: "accepted" }), printer({ key: "usb:off", kitchen: "off" })])] });
    await expect(service.printOrder("r1", order())).resolves.toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await expect(service.printOrder("r1", order())).resolves.toBe(1);
    expect(jobs.rows).toHaveLength(2);
  });

  it("does nothing without agents and never lets a failure reach the order flow", async () => {
    const empty = setup({ agents: [] });
    await empty.service.orderCreated("r1", order());
    expect(empty.jobs.insert).not.toHaveBeenCalled();

    const broken = setup({ failAgents: true });
    await expect(broken.service.orderCreated("r1", order())).resolves.toBeUndefined();
    await expect(broken.service.orderPaid("r1", order(), "cash", "Ana")).resolves.toBeUndefined();
    expect(broken.logger.warn).toHaveBeenCalledTimes(2);
  });
});

describe("PrintJobsService receipts", () => {
  it("prints one receipt per payment on receipt printers only", async () => {
    const cashier = printer({ key: "usb:caja", kitchen: "off", receipts: true, copies: 3 });
    const { service, jobs } = setup({ agents: [agent([printer(), cashier])] });

    await service.orderPaid("r1", order(), "card_pos", "Ana");
    await service.orderPaid("r1", order(), "card_pos", "Ana");
    expect(jobs.rows).toHaveLength(1);
    expect(jobs.rows[0]).toMatchObject({ printerKey: "usb:caja", kind: "receipt", copies: 1, dedupeKey: "receipt:order:o1:a1:usb:caja" });
    expect(jobs.rows[0]!.lines.map((l) => l.text)).toContain("Comprobante interno, no válido como boleta");

    await service.tablePayment("r1", {
      sessionId: "s1",
      paymentId: "pay1",
      tableLabel: "Mesa 4",
      at: new Date(),
      byName: "Gabi",
      method: "cash",
      payment: { kind: "equal", part: 1, parts: 2, amount: 5000, tip: 0, items: [] },
      account: { total: 10000, paid: 5000, remaining: 5000, closed: false },
    });
    expect(jobs.rows[1]).toMatchObject({ dedupeKey: "receipt:pay1:a1:usb:caja", tableSessionId: "s1", paymentId: "pay1", label: "Comprobante Mesa 4" });
  });
});

describe("PrintJobsService agents", () => {
  const queuedAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const job = (over: Partial<PrintJobRecord>): PrintJobRecord => ({
    id: "0".repeat(23) + "a",
    restaurantId: "r1",
    agentId: "a1",
    printerKey: "usb:EPSON",
    kind: "kitchen",
    label: "Comanda #1",
    dedupeKey: "k",
    orderId: "o1",
    orderRevision: 0,
    tableSessionId: null,
    paymentId: null,
    lines: [],
    paper: "80",
    copies: 1,
    status: "queued",
    attempts: 0,
    error: null,
    queuedAt: new Date(),
    printedAt: null,
    createdAt: new Date(),
    ...over,
  });

  it("expires old kitchen tickets on reconnection, keeps recent receipts and re-sends the rest", async () => {
    const seed = [
      job({ id: "a".repeat(24), kind: "kitchen", queuedAt: queuedAgo(31) }),
      job({ id: "b".repeat(24), kind: "kitchen", queuedAt: queuedAgo(5), status: "sent", attempts: 1 }),
      job({ id: "c".repeat(24), kind: "receipt", queuedAt: queuedAgo(120) }),
      job({ id: "d".repeat(24), kind: "receipt", queuedAt: queuedAgo(25 * 60) }),
      job({ id: "e".repeat(24), printerKey: "usb:gone", queuedAt: queuedAgo(1) }),
      job({ id: "f".repeat(24), printerKey: "usb:unplugged", queuedAt: queuedAgo(1) }),
    ];
    const a = agent([printer(), printer({ key: "usb:unplugged", reported: false })]);
    const { service, jobs, sent, staff } = setup({ agents: [a], seed });

    await service.resendPending(a);

    const status = Object.fromEntries(jobs.rows.map((j) => [j.id[0], j.status]));
    expect(status).toEqual({ a: "expired", b: "sent", c: "sent", d: "expired", e: "expired", f: "expired" });
    expect(sent.map((s) => (s.payload as { jobId: string }).jobId[0])).toEqual(["b", "c"]);
    expect(jobs.rows.find((j) => j.id[0] === "b")!.attempts).toBe(2);
    // The staff hear about the expired ones.
    expect(staff.map((s) => s.event)).toEqual(["print.job-failed", "print.job-failed"]);
  });

  it("records results of the agent's own jobs only and announces failures", async () => {
    const seed = [job({ id: "a".repeat(24), status: "sent" }), job({ id: "b".repeat(24), status: "sent", agentId: "other" })];
    const { service, jobs, staff } = setup({ seed });

    await expect(service.handleResult({ id: "a1", restaurantId: "r1" }, { jobId: "a".repeat(24), ok: false, error: "Sin papel" })).resolves.toEqual({ ok: true });
    expect(jobs.rows[0]).toMatchObject({ status: "failed", error: "Sin papel" });
    expect(staff[0]).toMatchObject({ event: "print.job-failed", payload: { status: "failed", error: "Sin papel", agentName: "Cocina" } });

    await service.handleResult({ id: "a1", restaurantId: "r1" }, { jobId: "a".repeat(24), ok: true });
    expect(jobs.rows[0]!.status).toBe("printed");
    // A duplicate confirmation is fine; someone else's job is not found.
    await expect(service.handleResult({ id: "a1", restaurantId: "r1" }, { jobId: "a".repeat(24), ok: true })).resolves.toEqual({ ok: true });
    await expect(service.handleResult({ id: "a1", restaurantId: "r1" }, { jobId: "b".repeat(24), ok: true })).resolves.toEqual({
      ok: false,
      code: "JOB_NOT_FOUND",
    });
  });

  it("retries failed jobs only, and not for unpaired agents", async () => {
    const seed = [job({ id: "a".repeat(24), status: "failed", error: "Sin papel" }), job({ id: "b".repeat(24), status: "printed" })];
    const { service, sent } = setup({ seed });
    await expect(service.retry("r1", "a".repeat(24))).resolves.toMatchObject({ status: "sent", error: null });
    expect(sent).toHaveLength(1);
    await expect(service.retry("r1", "b".repeat(24))).rejects.toMatchObject({ response: { code: "PRINT_JOB_NOT_RETRYABLE" } });
    await expect(service.retry("r1", "f".repeat(24))).rejects.toMatchObject({ response: { code: "PRINT_JOB_NOT_FOUND" } });
    const orphan = setup({ agents: [], seed: [job({ id: "a".repeat(24), status: "failed" })] });
    await expect(orphan.service.retry("r1", "a".repeat(24))).rejects.toMatchObject({ response: { code: "PRINT_AGENT_REVOKED" } });
  });
});
