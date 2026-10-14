import type { OrderStatus } from "@app/types";
import { addDays, kitchenMinutes, type LiveSummaryInput, localTimeOfDay, summarizeLive } from "./live-summary";
import type { OrderRecord, StatusChangeRecord } from "./orders.repository";

const TZ = "America/Santiago";

function order(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    id: "o",
    restaurantId: "r1",
    number: 1,
    ticketNumber: 1,
    businessDate: "2026-10-14",
    channel: "dine_in",
    status: "served",
    statusHistory: [],
    paymentStatus: "unpaid",
    paymentMethod: null,
    paymentBreakdown: [],
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    currency: "CLP",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    note: "",
    tableId: null,
    tableLabel: null,
    estimatedReadyAt: null,
    delivery: null,
    expectedPayment: null,
    riderId: null,
    riderName: null,
    customerId: null,
    clientOrderId: "c",
    revision: 0,
    edits: [],
    tableSessionId: null,
    notifyBy: null,
    createdAt: new Date("2026-10-14T15:00:00Z"),
    updatedAt: new Date("2026-10-14T15:00:00Z"),
    ...overrides,
  };
}

const change = (status: OrderStatus, at: string): StatusChangeRecord => ({
  status,
  at: new Date(at),
  byUserId: null,
  byName: null,
  reason: null,
});

/** Wednesday 2026-10-14, 13:30 in Santiago (UTC−3 in October). */
const NOW = new Date("2026-10-14T16:30:00Z");

function input(overrides: Partial<LiveSummaryInput> = {}): LiveSummaryInput {
  return {
    now: NOW,
    timeZone: TZ,
    currency: "CLP",
    kitchenTargetMinutes: 20,
    today: [],
    lastWeek: [],
    active: [],
    positionedTables: 0,
    openAccounts: [],
    ...overrides,
  };
}

describe("helpers", () => {
  it("moves calendar days across months and years", () => {
    expect(addDays("2026-10-14", -7)).toBe("2026-10-07");
    expect(addDays("2026-03-03", -7)).toBe("2026-02-24");
    expect(addDays("2026-01-02", -7)).toBe("2025-12-26");
  });

  it("reads the local clock of the restaurant", () => {
    expect(localTimeOfDay(NOW, TZ)).toEqual({ hour: 13, second: 13 * 3600 + 30 * 60 });
    expect(localTimeOfDay(new Date("2026-10-14T03:00:00Z"), TZ).hour).toBe(0);
  });
});

describe("summarizeLive", () => {
  it("sums today's sales per local hour, leaving rejected and cancelled orders out", () => {
    const summary = summarizeLive(
      input({
        today: [
          order({ total: 10_000, createdAt: new Date("2026-10-14T12:10:00Z") }), // 09:10 local
          order({ total: 5000, createdAt: new Date("2026-10-14T12:50:00Z") }), // 09:50 local
          order({ total: 7000, createdAt: new Date("2026-10-14T16:05:00Z"), status: "pending" }), // 13:05 local
          order({ total: 99_000, createdAt: new Date("2026-10-14T13:00:00Z"), status: "cancelled" }),
          order({ total: 88_000, createdAt: new Date("2026-10-14T13:00:00Z"), status: "rejected" }),
        ],
      }),
    );

    expect(summary.at).toBe(NOW.toISOString());
    expect(summary.sales).toEqual({ total: 22_000, currency: "CLP", changePercent: null });
    expect(summary.hourly).toHaveLength(14);
    expect(summary.hourly[9]).toEqual({ hour: 9, total: 15_000 });
    expect(summary.hourly[10]).toEqual({ hour: 10, total: 0 });
    expect(summary.hourly[13]).toEqual({ hour: 13, total: 7000 });
    expect(summary.hourly.reduce((sum, h) => sum + h.total, 0)).toBe(22_000);
  });

  it("compares with the same weekday last week only up to the same local time", () => {
    const summary = summarizeLive(
      input({
        today: [order({ total: 12_000 })],
        lastWeek: [
          order({ businessDate: "2026-10-07", total: 10_000, createdAt: new Date("2026-10-07T15:00:00Z") }), // 12:00
          order({ businessDate: "2026-10-07", total: 50_000, createdAt: new Date("2026-10-07T20:00:00Z") }), // 17:00: later
          order({ businessDate: "2026-10-07", total: 30_000, createdAt: new Date("2026-10-07T14:00:00Z"), status: "cancelled" }),
        ],
      }),
    );

    expect(summary.sales.changePercent).toBe(20);
  });

  it("compares local times across a daylight saving change, not 7 × 24 hours", () => {
    // Chile moves to UTC−3 on Sunday 2026-09-06. Tuesday 2026-09-08 13:00 local = 16:00Z; exactly 7 days
    // earlier is 12:00 local (UTC−4), so an order at 12:30 local last week is "before the same local time".
    const summary = summarizeLive(
      input({
        now: new Date("2026-09-08T16:00:00Z"),
        today: [order({ total: 5000, businessDate: "2026-09-08", createdAt: new Date("2026-09-08T15:00:00Z") })],
        lastWeek: [order({ total: 10_000, businessDate: "2026-09-01", createdAt: new Date("2026-09-01T16:30:00Z") })],
      }),
    );

    expect(localTimeOfDay(new Date("2026-09-01T16:30:00Z"), TZ).hour).toBe(12);
    expect(summary.sales.changePercent).toBe(-50);
  });

  it("counts the orders in progress per channel, of any day", () => {
    const summary = summarizeLive(
      input({
        active: [
          order({ channel: "dine_in", status: "pending" }),
          order({ channel: "dine_in", status: "preparing", businessDate: "2026-10-13" }),
          order({ channel: "pickup", status: "ready" }),
          order({ channel: "delivery", status: "out_for_delivery" }),
          order({ channel: "delivery", status: "delivered" }),
        ],
      }),
    );

    expect(summary.inProgress).toEqual({ dine_in: 2, pickup: 1, delivery: 1, total: 4 });
  });

  it("averages the kitchen time from accepted (or pending) to ready, of today's orders that reached ready", () => {
    const summary = summarizeLive(
      input({
        kitchenTargetMinutes: 15,
        today: [
          order({
            statusHistory: [
              change("pending", "2026-10-14T15:00:00Z"),
              change("accepted", "2026-10-14T15:05:00Z"),
              change("preparing", "2026-10-14T15:06:00Z"),
              change("ready", "2026-10-14T15:15:00Z"),
              change("served", "2026-10-14T15:20:00Z"),
            ],
          }),
          order({
            // Never accepted on its own (rare data): measured from pending.
            statusHistory: [change("pending", "2026-10-14T15:00:00Z"), change("ready", "2026-10-14T15:21:00Z")],
          }),
          order({ status: "preparing", statusHistory: [change("pending", "2026-10-14T15:00:00Z"), change("accepted", "2026-10-14T15:01:00Z")] }),
        ],
      }),
    );

    expect(summary.kitchen).toEqual({ averageMinutes: 16, targetMinutes: 15, sample: 2 });
  });

  it("has no kitchen average without orders that reached ready", () => {
    expect(summarizeLive(input()).kitchen).toEqual({ averageMinutes: null, targetMinutes: 20, sample: 0 });
    expect(kitchenMinutes(order({ statusHistory: [change("pending", "2026-10-14T15:00:00Z")] }))).toBeNull();
  });

  it("counts occupied tables, calls, bill requests and accounts paid in parts", () => {
    const account = (overrides: Partial<{ waiterCalledAt: Date; billRequestedAt: Date; payments: number }>, orders: number) => ({
      session: {
        waiterCalledAt: overrides.waiterCalledAt ?? null,
        billRequestedAt: overrides.billRequestedAt ?? null,
        payments: Array.from({ length: overrides.payments ?? 0 }) as never[],
      },
      orders,
    });
    const at = new Date("2026-10-14T16:00:00Z");
    const summary = summarizeLive(
      input({
        positionedTables: 8,
        openAccounts: [
          account({}, 2),
          account({ waiterCalledAt: at }, 0), // called the waiter before ordering: occupied
          account({ billRequestedAt: at, payments: 1 }, 3),
          account({}, 0), // empty account (e.g. a call already attended): not occupied
        ],
      }),
    );

    expect(summary.tables).toEqual({ positioned: 8, occupied: 3, callingWaiter: 1, billRequested: 1, payingInParts: 1 });
  });
});
