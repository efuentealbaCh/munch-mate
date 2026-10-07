import type { OrderStatus, OrderView } from "@app/types";
import { nextStatuses } from "@app/utils";
import { describe, expect, it } from "vitest";
import {
  ACTION_LABELS,
  boardTitle,
  canRegisterPayment,
  canWorkOrders,
  dayTotals,
  elapsedLabel,
  groupByColumn,
  mergeFetched,
  minutesSince,
  newerOrder,
  pendingCount,
  sortNewestFirst,
  upsertOrder,
} from "./orders-board";

const HISTORY: OrderStatus[] = ["pending", "accepted", "preparing", "ready", "served"];

function order(id: string, status: OrderStatus, overrides: Partial<OrderView> = {}): OrderView {
  const steps = HISTORY.includes(status) ? HISTORY.slice(0, HISTORY.indexOf(status) + 1) : ["pending" as const, status];
  return {
    id,
    number: Number(id.replace(/\D/g, "")) || 1,
    ticketNumber: Number(id.replace(/\D/g, "")) || 1,
    businessDate: "2026-10-07",
    channel: "dine_in",
    status,
    statusHistory: steps.map((s) => ({ status: s, at: "2026-10-07T12:00:00.000Z", byName: null })),
    paymentStatus: "unpaid",
    paymentMethod: null,
    items: [],
    subtotal: 1000,
    total: 1000,
    currency: "CLP",
    customerName: "",
    note: "",
    tableLabel: "Mesa 1",
    createdAt: "2026-10-07T12:00:00.000Z",
    ...overrides,
  };
}

describe("roles", () => {
  it("floor roles work orders; only owner and cashier register payments", () => {
    expect(canWorkOrders(["kitchen"])).toBe(true);
    expect(canWorkOrders(["rider"])).toBe(false);
    expect(canRegisterPayment(["kitchen"])).toBe(false);
    expect(canRegisterPayment(["cashier"])).toBe(true);
    expect(canRegisterPayment(["kitchen", "owner"])).toBe(true);
  });

  it("has a button label for every staff transition of the state machine", () => {
    for (const status of HISTORY) {
      for (const to of nextStatuses("dine_in", status, { kind: "staff", roles: ["owner"] })) {
        expect(ACTION_LABELS[to], `${status} → ${to}`).toBeTruthy();
      }
    }
    // Primary action first: what the big button shows.
    expect(nextStatuses("dine_in", "pending", { kind: "staff", roles: ["kitchen"] })[0]).toBe("accepted");
  });
});

describe("groupByColumn", () => {
  it("splits active orders by status, oldest first, and leaves final ones out", () => {
    const columns = groupByColumn([
      order("o2", "pending", { createdAt: "2026-10-07T12:05:00.000Z" }),
      order("o1", "pending", { createdAt: "2026-10-07T12:01:00.000Z" }),
      order("o3", "preparing"),
      order("o4", "served"),
      order("o5", "rejected"),
    ]);
    expect(columns.pending.map((o) => o.id)).toEqual(["o1", "o2"]);
    expect(columns.preparing.map((o) => o.id)).toEqual(["o3"]);
    expect(columns.accepted).toEqual([]);
    expect(columns.ready).toEqual([]);
  });
});

describe("merging events and REST data", () => {
  it("keeps the copy with more history (events and responses can arrive out of order)", () => {
    const pending = order("o1", "pending");
    const accepted = order("o1", "accepted");
    expect(newerOrder(accepted, pending)).toBe(accepted);
    expect(newerOrder(pending, accepted)).toBe(accepted);
    const paid = { ...accepted, paymentStatus: "paid" as const };
    expect(newerOrder(paid, accepted)).toBe(paid);
    expect(newerOrder(undefined, pending)).toBe(pending);
  });

  it("upserts and drops orders that reached a final status from the active board", () => {
    let list = upsertOrder([], order("o1", "pending"), true);
    list = upsertOrder(list, order("o2", "pending"), true);
    list = upsertOrder(list, order("o1", "accepted"), true);
    expect(list.find((o) => o.id === "o1")?.status).toBe("accepted");
    list = upsertOrder(list, order("o2", "rejected"), true);
    expect(list.map((o) => o.id)).toEqual(["o1"]);
    // The "Hoy" list keeps finished orders.
    expect(upsertOrder([order("o2", "pending")], order("o2", "rejected"), false)[0]?.status).toBe("rejected");
  });

  it("does not let a stale event undo a newer state", () => {
    const list = upsertOrder([order("o1", "preparing")], order("o1", "accepted"), true);
    expect(list[0]?.status).toBe("preparing");
  });

  it("merges a fetched list without losing newer copies or orders created during the fetch", () => {
    const current = [order("o1", "ready"), order("o9", "pending")];
    const fetched = [order("o1", "preparing"), order("o2", "pending")];
    const merged = mergeFetched(current, fetched, true, new Set(["o9"]));
    expect(merged.map((o) => `${o.id}:${o.status}`)).toEqual(["o1:ready", "o2:pending", "o9:pending"]);
    // Without the "received during fetch" mark, an order missing from the response is gone (finished elsewhere).
    expect(mergeFetched(current, fetched, true).map((o) => o.id)).toEqual(["o1", "o2"]);
  });
});

describe("labels and counters", () => {
  it("counts pending orders for the tab title", () => {
    const list = [order("o1", "pending"), order("o2", "pending"), order("o3", "accepted")];
    expect(pendingCount(list)).toBe(2);
    expect(boardTitle(2)).toBe("(2) Pedidos");
    expect(boardTitle(0)).toBe("Pedidos");
  });

  it("formats the age of an order", () => {
    const created = "2026-10-07T12:00:00.000Z";
    const at = (minutes: number) => Date.parse(created) + minutes * 60_000;
    expect(minutesSince(created, at(0.5))).toBe(0);
    expect(minutesSince(created, at(-3))).toBe(0);
    expect(minutesSince(created, at(12))).toBe(12);
    expect(minutesSince("not a date", at(12))).toBe(0);
    expect(elapsedLabel(0)).toBe("recién");
    expect(elapsedLabel(7)).toBe("hace 7 min");
    expect(elapsedLabel(65)).toBe("hace 1 h 05 min");
  });
});

describe("dayTotals", () => {
  it("sums sales and payments, leaving rejected and cancelled apart", () => {
    const totals = dayTotals([
      order("o1", "served", { total: 5000, paymentStatus: "paid", paymentMethod: "cash" }),
      order("o2", "preparing", { total: 3000 }),
      order("o3", "rejected", { total: 9000 }),
      order("o4", "cancelled", { total: 1000 }),
    ]);
    expect(totals).toEqual({ count: 2, total: 8000, paid: 5000, dropped: 2 });
    expect(dayTotals([])).toEqual({ count: 0, total: 0, paid: 0, dropped: 0 });
  });

  it("sorts newest first", () => {
    const list = sortNewestFirst([
      order("o1", "served", { createdAt: "2026-10-07T10:00:00.000Z" }),
      order("o2", "pending", { createdAt: "2026-10-07T12:00:00.000Z" }),
    ]);
    expect(list.map((o) => o.id)).toEqual(["o2", "o1"]);
  });
});
