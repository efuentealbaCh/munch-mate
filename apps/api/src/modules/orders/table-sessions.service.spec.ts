import type { Connection } from "mongoose";
import type { RealtimeService } from "../realtime/realtime.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import type { RestaurantsRepository } from "../restaurants/restaurants.repository";
import type { UsersRepository } from "../users/users.repository";
import type { OrderRecord, OrdersRepository } from "./orders.repository";
import type { TableSessionRecord, TableSessionsRepository } from "./table-sessions.repository";
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
  ...over,
});

function order(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "o1",
    restaurantId: "r1",
    status: "served",
    paymentStatus: "unpaid",
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

function setup(options: { open?: TableSessionRecord | null; orders?: OrderRecord[]; closeResult?: TableSessionRecord | null } = {}) {
  const emitted: string[] = [];
  const open = options.open === undefined ? session() : options.open;
  const sessions = {
    getOrOpen: jest.fn(async () => open ?? session()),
    findOpenByTable: jest.fn(async () => open),
    findRecentlyClosedByTable: jest.fn(async () => null),
    findOne: jest.fn(async () => open ?? session()),
    listOpen: jest.fn(async () => (open ? [open] : [])),
    listClosedBetween: jest.fn(async () => [
      session({ status: "closed", closedBusinessDate: "2026-10-13", tip: 2000 }),
      session({ status: "closed", closedBusinessDate: "2026-10-13", tip: 1500 }),
      session({ status: "closed", closedBusinessDate: "2026-10-14", tip: null }),
    ]),
    callWaiter: jest.fn(async () => open),
    requestBill: jest.fn(async () => open),
    attend: jest.fn(async () => open),
    close: jest.fn(async () => (options.closeResult === undefined ? session({ status: "closed", closedAt: new Date(), tip: 2000, paymentMethod: "card_pos" }) : options.closeResult)),
  };
  const orders = {
    listByTableSession: jest.fn(async () => options.orders ?? [order()]),
    listByTableSessions: jest.fn(async () => new Map([["s1", options.orders ?? [order()]]])),
    payTableSession: jest.fn(async () => undefined),
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

    expect(sessions.close).toHaveBeenCalledWith(
      "r1",
      "s1",
      expect.objectContaining({ tip: 2000, method: "card_pos", byUserId: "w1", byName: "Gabi Garzón" }),
      {},
    );
    expect(orders.payTableSession).toHaveBeenCalledWith("r1", "s1", "card_pos", {});
    expect(view).toMatchObject({ status: "closed", tip: 2000, paymentMethod: "card_pos" });
    expect(emitted).toEqual(["restaurant:order.updated", "restaurant:table.updated", "table:table.bill"]);
  });

  it("does not charge while an order is still in the kitchen", async () => {
    const { service, orders } = setup({ orders: [order({ status: "preparing" })] });
    await expect(service.close(tenant, "w1", "s1", { method: "cash", tip: 0 })).rejects.toMatchObject({
      response: { code: "TABLE_ORDERS_IN_PROGRESS" },
    });
    expect(orders.payTableSession).not.toHaveBeenCalled();
  });

  it("does not charge twice when two waiters close the same table", async () => {
    const { service, orders } = setup({ closeResult: null });
    await expect(service.close(tenant, "w1", "s1", { method: "cash", tip: 0 })).rejects.toMatchObject({
      response: { code: "TABLE_SESSION_NOT_FOUND" },
    });
    expect(orders.payTableSession).not.toHaveBeenCalled();
  });

  it("adds up the tips of each business day", async () => {
    const tips = await setup().service.tipsByDay("r1", "2026-10-13", "2026-10-14");
    expect([...tips.entries()]).toEqual([
      ["2026-10-13", 3500],
      ["2026-10-14", 0],
    ]);
  });
});
