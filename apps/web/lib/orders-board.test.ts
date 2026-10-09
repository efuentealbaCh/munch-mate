import type { OrderStatus, OrderView } from "@app/types";
import { nextStatuses } from "@app/utils";
import { describe, expect, it } from "vitest";
import {
  ACTION_LABELS,
  actionStep,
  availableChannelFilters,
  boardColumns,
  boardTitle,
  canAssignRider,
  canRegisterPayment,
  canWorkOrders,
  dayTotals,
  destinationLabel,
  elapsedLabel,
  filterByChannel,
  groupByColumn,
  handOverStatus,
  isPastReadyTime,
  isRider,
  isRiderOnly,
  mergeFetched,
  minutesSince,
  needsPaymentWarning,
  newerOrder,
  pendingCount,
  REASON_DIALOG_TEXTS,
  restaurantHomeHref,
  RIDER_ACTION_LABELS,
  RIDER_ACTOR,
  sortNewestFirst,
  sortRiderDeliveries,
  upsertOrder,
  upsertRiderDelivery,
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
    customerPhone: "",
    customerEmail: "",
    note: "",
    tableLabel: "Mesa 1",
    estimatedReadyAt: null,
    receiptAvailable: false,
    deliveryFee: 0,
    delivery: null,
    expectedPayment: null,
    rider: null,
    createdAt: "2026-10-07T12:00:00.000Z",
    // Same instant for every copy, so ties fall back to the revision (status history and payment).
    updatedAt: "2026-10-07T12:00:00.000Z",
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

describe("pickup orders", () => {
  const pickup = (id: string, status: OrderStatus, overrides: Partial<OrderView> = {}) =>
    order(id, status, { channel: "pickup", tableLabel: null, customerName: "Ana", customerPhone: "+56912345678", ...overrides });

  it("labels every pickup action, ending with Entregar", () => {
    const staff = { kind: "staff" as const, roles: ["owner" as const] };
    for (const status of ["pending", "accepted", "preparing", "ready"] as const) {
      for (const next of nextStatuses("pickup", status, staff)) expect(ACTION_LABELS[next], `${status} → ${next}`).toBeDefined();
    }
    expect(nextStatuses("pickup", "ready", staff)).toEqual(["picked_up"]);
    expect(ACTION_LABELS.picked_up).toBe("Entregar");
  });

  it("names the destination: the table or «Para retirar»", () => {
    expect(destinationLabel(order("o1", "pending"))).toBe("Mesa 1");
    expect(destinationLabel(order("o2", "pending", { tableLabel: null }))).toBe("Sin mesa");
    expect(destinationLabel(pickup("o3", "pending"))).toBe("Para retirar");
  });

  it("filters by channel without touching the list", () => {
    const list = [order("o1", "pending"), pickup("o2", "pending"), order("o3", "ready")];
    expect(filterByChannel(list, "all").map((o) => o.id)).toEqual(["o1", "o2", "o3"]);
    expect(filterByChannel(list, "dine_in").map((o) => o.id)).toEqual(["o1", "o3"]);
    expect(filterByChannel(list, "pickup").map((o) => o.id)).toEqual(["o2"]);
    expect(list).toHaveLength(3);
  });

  it("warns only when handing over an unpaid order", () => {
    expect(needsPaymentWarning(pickup("o1", "ready"), "picked_up")).toBe(true);
    expect(needsPaymentWarning(pickup("o1", "ready", { paymentStatus: "paid", paymentMethod: "cash" }), "picked_up")).toBe(false);
    expect(needsPaymentWarning(pickup("o1", "preparing"), "ready")).toBe(false);
  });

  it("flags a promised time that passed while the order is still in the kitchen", () => {
    const eta = "2026-10-07T12:30:00.000Z";
    const after = Date.parse("2026-10-07T12:31:00.000Z");
    const before = Date.parse("2026-10-07T12:29:00.000Z");
    expect(isPastReadyTime(pickup("o1", "preparing", { estimatedReadyAt: eta }), after)).toBe(true);
    expect(isPastReadyTime(pickup("o1", "preparing", { estimatedReadyAt: eta }), before)).toBe(false);
    expect(isPastReadyTime(pickup("o1", "ready", { estimatedReadyAt: eta }), after)).toBe(false);
    expect(isPastReadyTime(pickup("o1", "accepted", { estimatedReadyAt: null }), after)).toBe(false);
    expect(isPastReadyTime(pickup("o1", "accepted", { estimatedReadyAt: eta }), 0)).toBe(false);
  });

  it("counts picked-up orders as sales", () => {
    const totals = dayTotals([pickup("o1", "picked_up", { total: 2000 }), pickup("o2", "cancelled", { total: 500 })]);
    expect(totals).toEqual({ count: 1, total: 2000, paid: 0, dropped: 1 });
  });
});

describe("delivery orders", () => {
  const delivery = (id: string, status: OrderStatus, overrides: Partial<OrderView> = {}) =>
    order(id, status, {
      channel: "delivery",
      tableLabel: null,
      customerName: "Ana",
      customerPhone: "+56912345678",
      deliveryFee: 1990,
      delivery: { zoneId: "z1", zoneName: "Ñuñoa", address: "Av. Italia 1234", unit: "", reference: "" },
      expectedPayment: { method: "cash", cashAmount: 20000, change: 3010 },
      ...overrides,
    });
  const staff = { kind: "staff" as const, roles: ["owner" as const] };

  it("labels every delivery action and ends with out for delivery → delivered", () => {
    for (const status of ["pending", "accepted", "preparing", "ready", "out_for_delivery"] as const) {
      for (const next of nextStatuses("delivery", status, staff)) expect(ACTION_LABELS[next], `${status} → ${next}`).toBeDefined();
    }
    expect(nextStatuses("delivery", "ready", staff)).toEqual(["out_for_delivery"]);
    expect(nextStatuses("delivery", "out_for_delivery", staff)).toEqual(["delivered"]);
  });

  it("names the zone and hands over with «delivered»", () => {
    expect(destinationLabel(delivery("o1", "pending"))).toBe("Delivery · Ñuñoa");
    expect(destinationLabel(delivery("o1", "pending", { delivery: null }))).toBe("Delivery");
    expect(handOverStatus("delivery")).toBe("delivered");
    expect(handOverStatus("pickup")).toBe("picked_up");
    expect(handOverStatus("dine_in")).toBeNull();
    expect(needsPaymentWarning(delivery("o1", "out_for_delivery"), "delivered")).toBe(true);
    expect(needsPaymentWarning(delivery("o1", "ready"), "out_for_delivery")).toBe(false);
  });

  it("puts orders on the road in their own column, shown only when delivery matters", () => {
    expect(groupByColumn([delivery("o1", "out_for_delivery")]).out_for_delivery.map((o) => o.id)).toEqual(["o1"]);
    expect(boardColumns(false).map((c) => c.status)).not.toContain("out_for_delivery");
    expect(boardColumns(true).at(-1)?.status).toBe("out_for_delivery");
  });

  it("is late while the promised arrival passed and it is not delivered yet", () => {
    const eta = "2026-10-07T12:30:00.000Z";
    const after = Date.parse("2026-10-07T12:31:00.000Z");
    expect(isPastReadyTime(delivery("o1", "out_for_delivery", { estimatedReadyAt: eta }), after)).toBe(true);
    expect(isPastReadyTime(delivery("o1", "ready", { estimatedReadyAt: eta }), after)).toBe(true);
    expect(isPastReadyTime(delivery("o1", "delivered", { estimatedReadyAt: eta }), after)).toBe(false);
  });

  it("offers only the channel filters in use", () => {
    const off = { pickupEnabled: false, deliveryEnabled: false };
    expect(availableChannelFilters(off, [order("o1", "pending")])).toEqual([]);
    expect(availableChannelFilters({ ...off, deliveryEnabled: true }, []).map((f) => f.value)).toEqual(["all", "dine_in", "delivery"]);
    expect(availableChannelFilters({ pickupEnabled: true, deliveryEnabled: false }, [delivery("o1", "pending")]).map((f) => f.label)).toEqual([
      "Todos",
      "Mesa",
      "Retiro",
      "Delivery",
    ]);
    const list = [order("o1", "pending"), delivery("o2", "pending")];
    expect(filterByChannel(list, "delivery").map((o) => o.id)).toEqual(["o2"]);
  });
});

describe("riders", () => {
  const assigned = (id: string, status: OrderStatus, riderId: string | null) =>
    order(id, status, {
      channel: "delivery",
      tableLabel: null,
      rider: riderId ? { id: riderId, name: "Rodrigo" } : null,
    });

  it("permissions: owner and cashier assign; riders without floor roles land on their deliveries", () => {
    expect(canAssignRider(["owner"])).toBe(true);
    expect(canAssignRider(["cashier"])).toBe(true);
    expect(canAssignRider(["kitchen"])).toBe(false);
    expect(canAssignRider(["rider"])).toBe(false);
    expect(isRider(["kitchen", "rider"])).toBe(true);
    expect(isRiderOnly(["rider"])).toBe(true);
    expect(isRiderOnly(["kitchen", "rider"])).toBe(false);
    expect(canWorkOrders(["rider"])).toBe(false);
    expect(restaurantHomeHref({ id: "r1", myRoles: ["rider"] })).toBe("/admin/r1/repartos");
    expect(restaurantHomeHref({ id: "r1", myRoles: ["owner", "rider"] })).toBe("/admin/r1");
  });

  it("a rider may only take ready orders out and deliver them", () => {
    expect(nextStatuses("delivery", "pending", RIDER_ACTOR)).toEqual([]);
    expect(nextStatuses("delivery", "preparing", RIDER_ACTOR)).toEqual([]);
    expect(nextStatuses("delivery", "ready", RIDER_ACTOR)).toEqual(["out_for_delivery"]);
    expect(nextStatuses("delivery", "out_for_delivery", RIDER_ACTOR)).toEqual(["delivered"]);
    expect(RIDER_ACTION_LABELS.out_for_delivery).toBe("Salir a repartir");
  });

  it("keeps only my deliveries in progress from the restaurant's events", () => {
    let list = upsertRiderDelivery([], assigned("o1", "ready", "me"), "me");
    expect(list.map((o) => o.id)).toEqual(["o1"]);
    list = upsertRiderDelivery(list, assigned("o2", "ready", "other"), "me");
    expect(list.map((o) => o.id)).toEqual(["o1"]);
    list = upsertRiderDelivery(list, order("o3", "pending"), "me");
    expect(list.map((o) => o.id)).toEqual(["o1"]);
    // Reassigned to someone else, or delivered: it leaves my list.
    expect(upsertRiderDelivery(list, assigned("o1", "ready", "other"), "me")).toEqual([]);
    const delivered = {
      ...assigned("o1", "delivered", "me"),
      statusHistory: (["pending", "accepted", "preparing", "ready", "out_for_delivery", "delivered"] as const).map((status) => ({
        status,
        at: "2026-10-07T12:00:00.000Z",
        byName: null,
      })),
    };
    expect(upsertRiderDelivery(list, delivered, "me")).toEqual([]);
  });

  it("sorts what is on the road first", () => {
    const sorted = sortRiderDeliveries([
      assigned("o1", "preparing", "me"),
      assigned("o2", "ready", "me"),
      assigned("o3", "out_for_delivery", "me"),
    ]);
    expect(sorted.map((o) => o.id)).toEqual(["o3", "o2", "o1"]);
  });
});

describe("newerOrder by updatedAt", () => {
  it("keeps the copy written last, even when only the rider changed", () => {
    const old = order("o1", "ready", { channel: "delivery", rider: null, updatedAt: "2026-10-07T12:00:00.000Z" });
    const assigned = order("o1", "ready", {
      channel: "delivery",
      rider: { id: "r1", name: "Pedro" },
      updatedAt: "2026-10-07T12:00:05.000Z",
    });

    expect(newerOrder(assigned, old).rider).toEqual({ id: "r1", name: "Pedro" });
    expect(newerOrder(old, assigned).rider).toEqual({ id: "r1", name: "Pedro" });
  });
});

describe("actionStep (what happens when the staff tap an action)", () => {
  const owner = ["owner"] as const;

  it("asks for a reason to reject and to cancel, in every channel, before and after accepting", () => {
    for (const channel of ["dine_in", "pickup", "delivery"] as const) {
      expect(actionStep(order("o1", "pending", { channel }), "rejected", owner), channel).toBe("reason");
      expect(actionStep(order("o1", "pending", { channel }), "cancelled", owner), channel).toBe("reason");
      expect(actionStep(order("o1", "accepted", { channel }), "cancelled", owner), channel).toBe("reason");
    }
  });

  it("asks for the ready time when accepting pickup and delivery, not dine-in", () => {
    expect(actionStep(order("o1", "pending", { channel: "pickup" }), "accepted", owner)).toBe("ready_time");
    expect(actionStep(order("o1", "pending", { channel: "delivery" }), "accepted", owner)).toBe("ready_time");
    expect(actionStep(order("o1", "pending"), "accepted", owner)).toBe("direct");
  });

  it("warns before handing over an unpaid order; other steps go straight to the api", () => {
    expect(actionStep(order("o1", "ready", { channel: "pickup" }), "picked_up", owner)).toBe("payment_warning");
    expect(actionStep(order("o1", "ready", { channel: "pickup", paymentStatus: "paid" }), "picked_up", owner)).toBe("direct");
    expect(actionStep(order("o1", "accepted"), "preparing", owner)).toBe("direct");
  });

  it("leaves transitions the actor may not make to the api (it answers with its own error)", () => {
    expect(actionStep(order("o1", "pending"), "cancelled", ["rider"])).toBe("direct");
  });

  it("has its own texts for rejecting and cancelling", () => {
    expect(REASON_DIALOG_TEXTS.rejected.submit).toBe("Rechazar pedido");
    expect(REASON_DIALOG_TEXTS.cancelled.submit).toBe("Cancelar pedido");
    expect(REASON_DIALOG_TEXTS.cancelled.quickReasons.length).toBeGreaterThan(0);
  });
});
