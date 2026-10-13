import type { Connection } from "mongoose";
import type { RealtimeService } from "../realtime/realtime.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import type { RestaurantsRepository } from "../restaurants/restaurants.repository";
import type { UsersRepository } from "../users/users.repository";
import type { OrderRecord, OrdersRepository } from "./orders.repository";
import type { TableSplit } from "@app/types";
import type {
  CloseChange,
  NewTablePayment,
  TablePaymentRecord,
  TableSessionRecord,
  TableSessionsRepository,
} from "./table-sessions.repository";
import { TableSessionsService } from "./table-sessions.service";
import type { TablesRepository } from "./tables.repository";

const table = { id: "t1", restaurantId: "r1", label: "Mesa 4", token: "qr-mesa-4", active: true };
const restaurant = { id: "r1", status: "active", currency: "CLP", tipPercent: 10, timezone: "America/Santiago" };
const tenant: TenantContext = { restaurantId: "r1", roles: ["waiter"], status: "active" };

const session = (over: Partial<TableSessionRecord> = {}): TableSessionRecord => ({
  id: "s1",
  restaurantId: "r1",
  tableId: "t1",
  tableLabel: "Mesa 4",
  status: "open",
  openedAt: new Date(),
  waiterCalledAt: null,
  billRequestedAt: null,
  requestedTip: null,
  closedAt: null,
  closedBusinessDate: null,
  tip: null,
  paymentMethod: null,
  closedByName: null,
  paymentMethods: [],
  split: null,
  payments: [],
  revision: 0,
  ...over,
});

const payment = (over: Partial<TablePaymentRecord> = {}): TablePaymentRecord => ({
  id: "pay1",
  kind: "amount",
  amount: 0,
  tip: 0,
  method: "cash",
  part: null,
  items: [],
  at: new Date(),
  byUserId: "w1",
  byName: "Gabi Garzón",
  ...over,
});

function order(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "o1",
    restaurantId: "r1",
    status: "served",
    paymentStatus: "unpaid",
    paymentBreakdown: [],
    total: 20000,
    items: [{ productId: "p1", name: "Lomo", unitPrice: 20000, regularUnitPrice: 20000, promoLabel: "", quantity: 1, note: "", lineTotal: 20000, modifiers: [] }],
    createdAt: new Date(),
    updatedAt: new Date(),
    tableSessionId: "s1",
    channel: "dine_in",
    statusHistory: [],
    estimatedReadyAt: null,
    delivery: null,
    expectedPayment: null,
    riderId: null,
    riderName: null,
    revision: 0,
    edits: [],
    ...over,
  } as unknown as OrderRecord;
}

function setup(
  options: {
    open?: TableSessionRecord | null;
    orders?: OrderRecord[];
    /** What the conditional write returns; undefined = it applies the change. */
    chargeResult?: TableSessionRecord | null;
    /** What a second read of the account returns (after a conditional write missed). */
    reread?: TableSessionRecord | null;
  } = {},
) {
  const emitted: string[] = [];
  const open = options.open === undefined ? session() : options.open;
  let reads = 0;
  const sessions = {
    getOrOpen: jest.fn(async () => open ?? session()),
    findOpenByTable: jest.fn(async () => open),
    findRecentlyClosedByTable: jest.fn(async () => null),
    findOne: jest.fn(async () => {
      reads++;
      return reads > 1 && options.reread !== undefined ? options.reread : (open ?? session());
    }),
    listOpen: jest.fn(async () => (open ? [open] : [])),
    listClosedBetween: jest.fn(async () => [
      session({ status: "closed", closedBusinessDate: "2026-10-13", tip: 2000 }),
      session({ status: "closed", closedBusinessDate: "2026-10-13", tip: 1500 }),
      session({ status: "closed", closedBusinessDate: "2026-10-14", tip: null }),
    ]),
    callWaiter: jest.fn(async () => open),
    requestBill: jest.fn(async () => open),
    attend: jest.fn(async () => open),
    charge: jest.fn(
      async (
        _r: string,
        _s: string,
        _revision: number,
        payment: NewTablePayment | null,
        close: CloseChange | null,
      ): Promise<TableSessionRecord | null> => {
        if (options.chargeResult !== undefined) return options.chargeResult;
        const current = open ?? session();
        return session({
          ...current,
          revision: current.revision + 1,
          payments: payment ? [...current.payments, { ...payment, id: `pay${current.payments.length + 1}` }] : current.payments,
          ...(close
            ? { status: "closed", closedAt: new Date(), tip: close.tip, paymentMethod: close.paymentMethod, paymentMethods: close.paymentMethods }
            : {}),
        });
      },
    ),
    setSplit: jest.fn(async (_r: string, _s: string, _revision: number, split: TableSplit | null) =>
      options.chargeResult !== undefined ? options.chargeResult : session({ ...(open ?? session()), split }),
    ),
    deletePayment: jest.fn(async (_r: string, _s: string, paymentId: string) =>
      options.chargeResult !== undefined
        ? options.chargeResult
        : session({ ...(open ?? session()), payments: (open ?? session()).payments.filter((p) => p.id !== paymentId) }),
    ),
  };
  const orders = {
    listByTableSession: jest.fn(async () => options.orders ?? [order()]),
    listByTableSessions: jest.fn(async () => new Map([["s1", options.orders ?? [order()]]])),
    payTableOrders: jest.fn(async (..._args: unknown[]) => undefined),
  };
  const realtime = {
    toRestaurant: () => ({ emit: (event: string) => emitted.push(`restaurant:${event}`) }),
    toTable: () => ({ emit: (event: string) => emitted.push(`table:${event}`) }),
  };
  const service = new TableSessionsService(
    sessions as unknown as TableSessionsRepository,
    orders as unknown as OrdersRepository,
    { findByToken: jest.fn(async (token: string) => (token === table.token ? table : null)) } as unknown as TablesRepository,
    { findById: jest.fn(async () => restaurant) } as unknown as RestaurantsRepository,
    { findById: jest.fn(async () => ({ id: "w1", name: "Gabi Garzón" })) } as unknown as UsersRepository,
    realtime as unknown as RealtimeService,
    { transaction: (fn: (s: unknown) => Promise<unknown>) => fn({}) } as unknown as Connection,
  );
  return { service, sessions, orders, emitted };
}

describe("TableSessionsService (customers at the table)", () => {
  it("answers unknown QR codes like inactive ones", async () => {
    await expect(setup().service.publicBill("nope")).rejects.toMatchObject({ response: { code: "TABLE_NOT_FOUND" } });
  });

  it("calls the waiter, opening the account if the table has not ordered yet, and tells the floor and the table", async () => {
    const { service, sessions, emitted } = setup({ open: null });
    await service.callWaiter(table.token);
    expect(sessions.getOrOpen).toHaveBeenCalledWith("r1", table);
    expect(sessions.callWaiter).toHaveBeenCalled();
    expect(emitted).toEqual(["restaurant:table.updated", "table:table.bill"]);
  });

  it("asks for the bill with the suggested tip computed by the server", async () => {
    const { service, sessions } = setup();
    await service.requestBill(table.token, { kind: "suggested" });
    expect(sessions.requestBill).toHaveBeenCalledWith("r1", "s1", 2000);
  });

  it("refuses the bill of a table that has nothing to pay, and tips that make no sense", async () => {
    await expect(setup({ open: null }).service.requestBill(table.token, { kind: "none" })).rejects.toMatchObject({
      response: { code: "NOTHING_TO_PAY" },
    });
    await expect(setup({ orders: [] }).service.requestBill(table.token, { kind: "none" })).rejects.toMatchObject({
      response: { code: "NOTHING_TO_PAY" },
    });
    await expect(setup().service.requestBill(table.token, { kind: "amount", amount: -5 })).rejects.toMatchObject({
      response: { code: "INVALID_TIP" },
    });
  });
});

describe("TableSessionsService (floor staff)", () => {
  it("charges the account: pays its orders, records the tip and tells everyone", async () => {
    const { service, sessions, orders, emitted } = setup();
    const view = await service.close(tenant, "w1", "s1", { method: "card_pos", tip: 2000 });

    expect(sessions.charge).toHaveBeenCalledWith(
      "r1",
      "s1",
      0,
      expect.objectContaining({ kind: "amount", amount: 20000, tip: 2000, method: "card_pos", byUserId: "w1", byName: "Gabi Garzón" }),
      expect.objectContaining({ tip: 2000, paymentMethod: "card_pos", paymentMethods: ["card_pos"], byUserId: "w1", byName: "Gabi Garzón" }),
      {},
    );
    expect(orders.payTableOrders).toHaveBeenCalledWith(
      "r1",
      "s1",
      [{ orderId: "o1", method: "card_pos", breakdown: [{ method: "card_pos", amount: 20000 }] }],
      {},
    );
    expect(view).toMatchObject({ status: "closed", tip: 2000, paymentMethod: "card_pos", remaining: 0, paid: 20000 });
    expect(emitted).toEqual(["restaurant:order.updated", "restaurant:table.updated", "table:table.bill"]);
  });

  it("does not charge while an order is still in the kitchen", async () => {
    const { service, sessions, orders } = setup({ orders: [order({ status: "preparing" })] });
    await expect(service.close(tenant, "w1", "s1", { method: "cash", tip: 0 })).rejects.toMatchObject({
      response: { code: "TABLE_ORDERS_IN_PROGRESS" },
    });
    expect(sessions.charge).not.toHaveBeenCalled();
    expect(orders.payTableOrders).not.toHaveBeenCalled();
  });

  it("does not charge twice when two waiters close the same table", async () => {
    const { service, orders } = setup({ chargeResult: null, reread: session({ status: "closed" }) });
    await expect(service.close(tenant, "w1", "s1", { method: "cash", tip: 0 })).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_NOT_FOUND" },
    });
    expect(orders.payTableOrders).not.toHaveBeenCalled();
  });

  it("closes without a new payment when the payments already cover it, adding the tip given now", async () => {
    const paid = session({ payments: [payment({ amount: 12000, method: "cash", tip: 1000 }), payment({ id: "pay2", amount: 8000, method: "card_pos" })] });
    const { service, sessions, orders } = setup({ open: paid });
    const view = await service.close(tenant, "w1", "s1", { method: "transfer", tip: 500 });

    expect(sessions.charge).toHaveBeenCalledWith(
      "r1",
      "s1",
      0,
      null,
      expect.objectContaining({ tip: 1500, paymentMethod: null, paymentMethods: ["cash", "card_pos"] }),
      {},
    );
    expect(orders.payTableOrders.mock.calls[0]![2]).toEqual([
      {
        orderId: "o1",
        method: "cash",
        breakdown: [
          { method: "cash", amount: 12000 },
          { method: "card_pos", amount: 8000 },
        ],
      },
    ]);
    expect(view).toMatchObject({ status: "closed", paymentMethod: null, paymentMethods: ["cash", "card_pos"] });
  });

  it("refuses to close when the payments exceed the bill (an order was cancelled after paying)", async () => {
    const { service, sessions } = setup({
      open: session({ payments: [payment({ amount: 25000 })] }),
      orders: [order(), order({ id: "o2", status: "cancelled", total: 5000 })],
    });
    await expect(service.close(tenant, "w1", "s1", { method: "cash", tip: 0 })).rejects.toMatchObject({
      status: 409,
      response: { code: "TABLE_OVERPAID", meta: { excess: "5000" } },
    });
    expect(sessions.charge).not.toHaveBeenCalled();
  });

  it("closes an account without orders with no payment and no tip", async () => {
    const { service, sessions, orders } = setup({ orders: [] });
    await service.close(tenant, "w1", "s1", { method: "cash", tip: 3000 });
    expect(sessions.charge).toHaveBeenCalledWith("r1", "s1", 0, null, expect.objectContaining({ tip: 0, paymentMethod: "cash" }), {});
    expect(orders.payTableOrders).toHaveBeenCalledWith("r1", "s1", [], {});
  });

  it("adds up the tips of each business day", async () => {
    const tips = await setup().service.tipsByDay("r1", "2026-10-13", "2026-10-14");
    expect([...tips.entries()]).toEqual([
      ["2026-10-13", 3500],
      ["2026-10-14", 0],
    ]);
  });
});

describe("TableSessionsService (split bills)", () => {
  const two = [order({ id: "o1", total: 12000 }), order({ id: "o2", total: 8001, createdAt: new Date(Date.now() + 1000) })];

  it("registers a partial payment while the kitchen is still working, without closing", async () => {
    const { service, sessions, orders, emitted } = setup({ orders: [order({ status: "preparing" })] });
    const view = await service.addPayment(tenant, "w1", "s1", { kind: "amount", amount: 5000, method: "cash", tip: 500 });

    expect(sessions.charge).toHaveBeenCalledWith(
      "r1",
      "s1",
      0,
      expect.objectContaining({ kind: "amount", amount: 5000, tip: 500, method: "cash", part: null, items: [] }),
      null,
      {},
    );
    expect(orders.payTableOrders).not.toHaveBeenCalled();
    expect(view).toMatchObject({ status: "open", paid: 5000, remaining: 15000 });
    expect(emitted).toEqual(["restaurant:table.updated", "table:table.bill"]);
  });

  it("does not register the payment that completes the bill while an order is in the kitchen", async () => {
    const { service, sessions } = setup({ orders: [order({ status: "ready" })] });
    await expect(
      service.addPayment(tenant, "w1", "s1", { kind: "amount", amount: 20000, method: "cash", tip: 0 }),
    ).rejects.toMatchObject({ status: 409, response: { code: "TABLE_ORDERS_IN_PROGRESS" } });
    expect(sessions.charge).not.toHaveBeenCalled();
  });

  it("charges equal parts computed by the server and closes with the last one, mixing methods", async () => {
    const half = session({ split: { mode: "equal", parts: 2 }, payments: [payment({ kind: "equal", part: 1, amount: 10000, method: "cash", tip: 1000 })] });
    const { service, sessions, orders, emitted } = setup({ open: half, orders: two });
    const view = await service.addPayment(tenant, "w1", "s1", { kind: "equal", part: 2, method: "card_pos", tip: 800 });

    expect(sessions.charge).toHaveBeenCalledWith(
      "r1",
      "s1",
      0,
      expect.objectContaining({ kind: "equal", part: 2, amount: 10001, method: "card_pos", tip: 800 }),
      expect.objectContaining({ tip: 1800, paymentMethod: null, paymentMethods: ["cash", "card_pos"] }),
      {},
    );
    expect(orders.payTableOrders.mock.calls[0]![2]).toEqual([
      { orderId: "o1", method: "cash", breakdown: [{ method: "cash", amount: 10000 }, { method: "card_pos", amount: 2000 }] },
      { orderId: "o2", method: "card_pos", breakdown: [{ method: "card_pos", amount: 8001 }] },
    ]);
    expect(view).toMatchObject({ status: "closed", paid: 20001, remaining: 0 });
    expect(emitted).toEqual(["restaurant:order.updated", "restaurant:order.updated", "restaurant:table.updated", "table:table.bill"]);
  });

  it("charges the first equal part rounded down", async () => {
    const { service, sessions } = setup({ open: session({ split: { mode: "equal", parts: 3 } }), orders: two });
    await service.addPayment(tenant, "w1", "s1", { kind: "equal", part: 3, method: "cash", tip: 0 });
    expect(sessions.charge.mock.calls[0]![3]).toMatchObject({ amount: 6667, part: 3 });
    expect(sessions.charge.mock.calls[0]![4]).toBeNull();
  });

  it.each([
    ["the account is not split in equal parts", session({ split: { mode: "items" } }), 1, 409, "SPLIT_MODE_MISMATCH"],
    ["the part does not exist", session({ split: { mode: "equal", parts: 2 } }), 3, 400, "INVALID_SPLIT_PART"],
    [
      "the part is already paid",
      session({ split: { mode: "equal", parts: 2 }, payments: [payment({ kind: "equal", part: 1, amount: 10000 })] }),
      1,
      409,
      "SPLIT_PART_PAID",
    ],
  ])("refuses an equal part when %s", async (_, open, part, status, code) => {
    const { service, sessions } = setup({ open, orders: two });
    await expect(service.addPayment(tenant, "w1", "s1", { kind: "equal", part, method: "cash", tip: 0 })).rejects.toMatchObject({
      status,
      response: { code },
    });
    expect(sessions.charge).not.toHaveBeenCalled();
  });

  it("prices products on the server and rejects lines that cannot be paid", async () => {
    const lines = [order({ id: "o1", total: 7000, items: [{ productId: "p1", name: "Completo", unitPrice: 3500, regularUnitPrice: 3500, promoLabel: "", quantity: 2, note: "", lineTotal: 7000, modifiers: [] }] })];
    const ok = setup({ orders: lines });
    await ok.service.addPayment(tenant, "w1", "s1", { kind: "items", items: [{ orderId: "o1", line: 0, quantity: 1 }], method: "transfer", tip: 0 });
    expect(ok.sessions.charge.mock.calls[0]![3]).toMatchObject({ kind: "items", amount: 3500, items: [{ orderId: "o1", line: 0, quantity: 1 }] });

    await expect(
      setup({ orders: lines }).service.addPayment(tenant, "w1", "s1", {
        kind: "items",
        items: [{ orderId: "o1", line: 0, quantity: 3 }],
        method: "cash",
        tip: 0,
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: "INVALID_SPLIT_ITEMS" } });
  });

  it("refuses amounts above what is left, and payments when nothing is left", async () => {
    const partly = session({ payments: [payment({ amount: 15000 })] });
    await expect(
      setup({ open: partly }).service.addPayment(tenant, "w1", "s1", { kind: "amount", amount: 6000, method: "cash", tip: 0 }),
    ).rejects.toMatchObject({ status: 409, response: { code: "PAYMENT_EXCEEDS_BALANCE", meta: { remaining: "5000" } } });

    const paid = session({ payments: [payment({ amount: 20000 })] });
    await expect(
      setup({ open: paid }).service.addPayment(tenant, "w1", "s1", { kind: "amount", amount: 1, method: "cash", tip: 0 }),
    ).rejects.toMatchObject({ status: 409, response: { code: "NOTHING_TO_PAY" } });
    await expect(
      setup({ orders: [] }).service.addPayment(tenant, "w1", "s1", { kind: "amount", amount: 1, method: "cash", tip: 0 }),
    ).rejects.toMatchObject({ status: 409, response: { code: "NOTHING_TO_PAY" } });
  });

  it("refuses payments to an account that is not open, and tips that make no sense", async () => {
    await expect(
      setup({ open: session({ status: "closed" }) }).service.addPayment(tenant, "w1", "s1", { kind: "amount", amount: 1, method: "cash", tip: 0 }),
    ).rejects.toMatchObject({ status: 404, response: { code: "TABLE_SESSION_NOT_FOUND" } });
    await expect(
      setup().service.addPayment(tenant, "w1", "s1", { kind: "amount", amount: 1, method: "cash", tip: -1 }),
    ).rejects.toMatchObject({ status: 400, response: { code: "INVALID_TIP" } });
  });

  it("does not record a payment computed on a stale account (two waiters charging at once)", async () => {
    const { service, orders } = setup({ chargeResult: null, reread: session({ revision: 1 }) });
    await expect(
      service.addPayment(tenant, "w1", "s1", { kind: "amount", amount: 20000, method: "cash", tip: 0 }),
    ).rejects.toMatchObject({ status: 409, response: { code: "TABLE_SESSION_CHANGED" } });
    expect(orders.payTableOrders).not.toHaveBeenCalled();
  });

  it("sets the plan on the revision it read, refusing fewer parts than those already paid", async () => {
    const paidTwo = session({
      revision: 4,
      split: { mode: "equal", parts: 4 },
      payments: [payment({ kind: "equal", part: 1, amount: 5000 }), payment({ id: "pay2", kind: "equal", part: 2, amount: 5000 })],
    });
    await expect(setup({ open: paidTwo }).service.setSplit(tenant, "s1", { mode: "equal", parts: 2 })).rejects.toMatchObject({
      status: 409,
      response: { code: "SPLIT_PARTS_PAID", meta: { paidParts: "2" } },
    });

    // Part 4 of 4 paid: 3 parts would leave it outside the plan.
    const paidLast = session({ revision: 4, split: { mode: "equal", parts: 4 }, payments: [payment({ kind: "equal", part: 4, amount: 5000 })] });
    await expect(setup({ open: paidLast }).service.setSplit(tenant, "s1", { mode: "equal", parts: 3 })).rejects.toMatchObject({
      status: 409,
      response: { code: "SPLIT_PARTS_PAID", meta: { highestPaidPart: "4" } },
    });

    const ok = setup({ open: paidTwo });
    const view = await ok.service.setSplit(tenant, "s1", { mode: "equal", parts: 3 });
    expect(ok.sessions.setSplit).toHaveBeenCalledWith("r1", "s1", 4, { mode: "equal", parts: 3 });
    expect(view.equalPart).toEqual({ amount: 10000, pendingParts: [3] });

    const other = setup({ open: paidTwo });
    await other.service.setSplit(tenant, "s1", { mode: "amounts" });
    await other.service.setSplit(tenant, "s1", null);
    expect(other.sessions.setSplit.mock.calls.map((call) => call[3])).toEqual([{ mode: "amounts" }, null]);

    await expect(setup().service.setSplit(tenant, "s1", { mode: "equal", parts: 21 })).rejects.toMatchObject({
      status: 400,
      response: { code: "INVALID_SPLIT_PARTS" },
    });
    await expect(
      setup({ chargeResult: null, reread: session({ revision: 1 }) }).service.setSplit(tenant, "s1", { mode: "items" }),
    ).rejects.toMatchObject({ response: { code: "TABLE_SESSION_CHANGED" } });
  });

  it("deletes a payment of an open account only", async () => {
    const withPayment = session({ payments: [payment({ amount: 5000 })] });
    const ok = setup({ open: withPayment });
    const view = await ok.service.deletePayment(tenant, "s1", "pay1");
    expect(ok.sessions.deletePayment).toHaveBeenCalledWith("r1", "s1", "pay1");
    expect(view).toMatchObject({ payments: [], remaining: 20000 });
    expect(ok.emitted).toEqual(["restaurant:table.updated", "table:table.bill"]);

    await expect(setup({ open: withPayment }).service.deletePayment(tenant, "s1", "nope")).rejects.toMatchObject({
      status: 404,
      response: { code: "TABLE_PAYMENT_NOT_FOUND" },
    });
    await expect(
      setup({ open: session({ status: "closed", payments: withPayment.payments }) }).service.deletePayment(tenant, "s1", "pay1"),
    ).rejects.toMatchObject({ status: 409, response: { code: "TABLE_SESSION_CLOSED" } });
    await expect(
      setup({ open: withPayment, chargeResult: null, reread: session({ status: "closed" }) }).service.deletePayment(tenant, "s1", "pay1"),
    ).rejects.toMatchObject({ status: 409, response: { code: "TABLE_SESSION_CLOSED" } });
  });
});
