import type { FloorPlan, FloorPlanView, LiveSummary, OrderStatus, OrderView, TableSessionView } from "@app/types";
import { floorPlanProblem } from "@app/utils";
import { describe, expect, it } from "vitest";
import {
  CELL,
  changeLabel,
  defaultPlan,
  diningLabelSpot,
  doorSide,
  featuredOrder,
  fitArt,
  floorEllipse,
  freeCorners,
  inProgressBreakdown,
  ISO_UNIT,
  kitchenGauge,
  kitchenGroups,
  liveLayout,
  nameSpot,
  orderWho,
  paintOrder,
  paintsBefore,
  parseTarget,
  pickupQueue,
  project,
  resolveTarget,
  salesComparison,
  sceneFrame,
  sparkline,
  tablesSummary,
  tableStatus,
  targetKey,
  timerLabel,
  trackingSteps,
} from "./live-floor";

const NOW = Date.parse("2026-10-14T23:41:00.000Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function order(over: Partial<OrderView> & { status?: OrderStatus; enteredMinutesAgo?: number } = {}): OrderView {
  const { enteredMinutesAgo = 1, ...rest } = over;
  const status = rest.status ?? "pending";
  return {
    id: "o1",
    number: 1,
    ticketNumber: 1,
    businessDate: "2026-10-14",
    channel: "dine_in",
    status,
    statusHistory: [{ status, at: ago(enteredMinutesAgo), byName: null }],
    paymentStatus: "unpaid",
    paymentMethod: null,
    paymentBreakdown: [],
    items: [{ productId: "p", name: "Pizza", unitPrice: 1000, regularUnitPrice: 1000, promoLabel: "", quantity: 2, modifiers: [], note: "", lineTotal: 2000 }],
    subtotal: 2000,
    total: 2000,
    currency: "CLP",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    note: "",
    tableLabel: "Mesa 4",
    estimatedReadyAt: null,
    receiptAvailable: false,
    deliveryFee: 0,
    delivery: null,
    expectedPayment: null,
    rider: null,
    tableSessionId: null,
    notifyBy: null,
    revision: 0,
    edits: [],
    createdAt: ago(enteredMinutesAgo),
    updatedAt: ago(enteredMinutesAgo),
    ...rest,
  } as OrderView;
}

function session(over: Partial<TableSessionView> = {}): TableSessionView {
  return {
    id: "s1",
    tableId: "t1",
    tableLabel: "Mesa 1",
    status: "open",
    openedAt: ago(30),
    closedAt: null,
    lines: [],
    orderIds: ["o1"],
    orderCount: 1,
    ordersInProgress: 0,
    unpaidOrders: 1,
    subtotal: 10000,
    currency: "CLP",
    tipPercent: 10,
    suggestedTip: 1000,
    waiterCalledAt: null,
    billRequestedAt: null,
    requestedTip: null,
    tip: null,
    paymentMethod: null,
    paymentMethods: [],
    closedByName: null,
    split: null,
    payments: [],
    paid: 0,
    remaining: 10000,
    itemLines: [],
    equalPart: null,
    ...over,
  };
}

const PLAN: FloorPlan = { cols: 14, rows: 9, kitchen: { x: 0, y: 0, w: 4, h: 3 }, pickup: { x: 11, y: 0, w: 3, h: 2 }, door: { x: 13, y: 8 } };

function view(plan: FloorPlan | null, tables: FloorPlanView["tables"] = []): FloorPlanView {
  return { plan, tables };
}

const TABLE_A = { id: "t1", label: "Mesa 1", active: true, layout: { x: 5, y: 4, shape: "round" as const, seats: 4 as const } };
const TABLE_B = { id: "t2", label: "Mesa 2", active: true, layout: { x: 7, y: 4, shape: "square" as const, seats: 6 as const } };

describe("isometric projection", () => {
  it("puts +x down-right and +y down-left at 30°, z straight up", () => {
    const [x1, y1] = project(1, 0);
    expect(x1).toBeCloseTo(Math.cos(Math.PI / 6) * ISO_UNIT);
    expect(y1).toBeCloseTo(ISO_UNIT / 2);
    const [x2, y2] = project(0, 1);
    expect(x2).toBeCloseTo(-x1);
    expect(y2).toBeCloseTo(y1);
    expect(project(0, 0, 1)).toEqual([0, -ISO_UNIT]);
  });

  it("an ellipse on the floor is a closed path; a circle of radius r measures about 2πr·U on the projected plane", () => {
    const ring = floorEllipse(0, 0, 1, 1);
    expect(ring.d.startsWith("M")).toBe(true);
    expect(ring.d.endsWith("Z")).toBe(true);
    // The projected circle is an ellipse with semi-axes U·√1.5 and U·√0.5.
    const a = ISO_UNIT * Math.sqrt(1.5);
    const b = ISO_UNIT * Math.sqrt(0.5);
    const ramanujan = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    expect(ring.length).toBeCloseTo(ramanujan, 0);
  });

  it("fits a drawing in a rectangle with one scale, against the back or centered", () => {
    const back = fitArt({ x: 2, y: 1, w: 4, h: 3 }, { w: 16, h: 16 }, "back");
    expect(back.scale).toBeCloseTo(12 / 16);
    expect(back.y).toBe(1 * CELL);
    expect(back.x).toBeCloseTo(2 * CELL + (16 - 12) / 2);
    const capped = fitArt({ x: 0, y: 0, w: 10, h: 10 }, { w: 4, h: 4 }, "center", 1.25);
    expect(capped.scale).toBe(1.25);
    expect(capped.y).toBeCloseTo((40 - 5) / 2);
  });
});

describe("paint order", () => {
  it("paints what is behind along x or y first", () => {
    expect(paintsBefore({ x: 0, y: 0, w: 1, h: 1 }, { x: 1, y: 0, w: 1, h: 1 })).toBe(true);
    expect(paintsBefore({ x: 1, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 })).toBe(false);
    // Side by side on screen (one to the left, one to the right): never cover each other.
    expect(paintsBefore({ x: 0, y: 3, w: 1, h: 1 }, { x: 3, y: 0, w: 1, h: 1 })).toBe(false);
  });

  it("handles long objects that sorting by center gets wrong", () => {
    const counter = { id: "counter", rect: { x: 5, y: 0, w: 1, h: 6 } };
    const table = { id: "table", rect: { x: 6, y: 0, w: 1, h: 1 } };
    const back = { id: "back", rect: { x: 0, y: 0, w: 1, h: 1 } };
    // By center: table (7) before counter (8.5), but the table is in front of it.
    expect(paintOrder([table, counter, back], (i) => i.rect).map((i) => i.id)).toEqual(["back", "counter", "table"]);
  });

  it("keeps a stable back-to-front order on a grid of tables", () => {
    const cells = [
      { id: "c", rect: { x: 1, y: 1, w: 1, h: 1 } },
      { id: "a", rect: { x: 0, y: 0, w: 1, h: 1 } },
      { id: "b", rect: { x: 1, y: 0, w: 2, h: 1 } },
    ];
    expect(paintOrder(cells, (i) => i.rect).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("which zones are drawn", () => {
  const flags = (pickupEnabled: boolean, deliveryEnabled: boolean) => ({ pickupEnabled, deliveryEnabled });

  it("without a plan: the default scene, kitchen only, no dining room", () => {
    const layout = liveLayout(view(null, [{ ...TABLE_A, layout: null }]), flags(false, false));
    expect(layout).toMatchObject({ hasPlan: false, dining: false, pickup: false, delivery: false, tables: [] });
    expect(layout.plan.pickup).toBeNull();
    expect(layout.plan.door).toBeNull();
    expect(layout.plan.kitchen).toBeTruthy();
  });

  it("without a plan the enabled zones go to default places", () => {
    expect(liveLayout(null, flags(true, false))).toMatchObject({ pickup: true, delivery: false });
    expect(liveLayout(null, flags(false, true))).toMatchObject({ pickup: false, delivery: true });
    const both = liveLayout(null, flags(true, true));
    expect(both).toMatchObject({ pickup: true, delivery: true, dining: false });
    expect(both.plan.pickup).not.toBeNull();
    expect(both.plan.door).not.toBeNull();
  });

  it("the default scenes are valid plans", () => {
    for (const pickup of [false, true]) for (const delivery of [false, true]) expect(floorPlanProblem(defaultPlan(pickup, delivery), [])).toBeNull();
  });

  it("a plan without active placed tables has no dining room", () => {
    expect(liveLayout(view(PLAN, []), flags(true, true)).dining).toBe(false);
    expect(liveLayout(view(PLAN, [{ ...TABLE_A, layout: null }]), flags(true, true)).dining).toBe(false);
    expect(liveLayout(view(PLAN, [{ ...TABLE_A, active: false }]), flags(true, true)).dining).toBe(false);
  });

  it("draws the active placed tables with their footprint", () => {
    const layout = liveLayout(view(PLAN, [TABLE_A, TABLE_B, { id: "t3", label: "Mesa 3", active: false, layout: { x: 9, y: 6, shape: "round", seats: 2 } }]), flags(false, false));
    expect(layout.dining).toBe(true);
    expect(layout.tables.map((t) => [t.id, t.rect])).toEqual([
      ["t1", { x: 5, y: 4, w: 1, h: 1 }],
      ["t2", { x: 7, y: 4, w: 2, h: 1 }],
    ]);
  });

  it("the counter needs pickupEnabled and a counter on the plan; the door needs deliveryEnabled and a door", () => {
    expect(liveLayout(view(PLAN), flags(false, false))).toMatchObject({ pickup: false, delivery: false });
    expect(liveLayout(view(PLAN), flags(false, false)).plan).toMatchObject({ pickup: null, door: null });
    expect(liveLayout(view(PLAN), flags(true, true))).toMatchObject({ pickup: true, delivery: true });
    const bare = { ...PLAN, pickup: null, door: null };
    expect(liveLayout(view(bare), flags(true, true))).toMatchObject({ pickup: false, delivery: false });
  });
});

describe("table state", () => {
  it("free without an open account (or an empty one)", () => {
    expect(tableStatus(undefined)).toMatchObject({ base: "free", indicator: "free", since: null, session: null });
    expect(tableStatus(session({ status: "closed" }))).toMatchObject({ indicator: "free", session: null });
    expect(tableStatus(session({ orderCount: 0, orderIds: [] }))).toMatchObject({ base: "free", indicator: "free", since: null });
  });

  it("order in the kitchen, then eating", () => {
    expect(tableStatus(session({ ordersInProgress: 1 }))).toMatchObject({ base: "kitchen", indicator: "kitchen", since: ago(30) });
    expect(tableStatus(session())).toMatchObject({ base: "eating", indicator: "eating" });
  });

  it("priority: called > bill > paying > kitchen > eating", () => {
    const payments = [{ id: "p", kind: "amount", amount: 2500, tip: 0, method: "cash", part: null, itemCount: 0, items: [], at: ago(2), byName: null }] as TableSessionView["payments"];
    const all = session({ ordersInProgress: 1, waiterCalledAt: ago(2), billRequestedAt: ago(5), payments, paid: 2500, remaining: 7500 });
    expect(tableStatus(all)).toMatchObject({ indicator: "waiter", base: "kitchen", waiter: true, bill: true, paying: true, since: ago(2) });
    expect(tableStatus({ ...all, waiterCalledAt: null })).toMatchObject({ indicator: "bill", since: ago(5) });
    const paying = tableStatus({ ...all, waiterCalledAt: null, billRequestedAt: null });
    expect(paying.indicator).toBe("paying");
    expect(paying.paidFraction).toBeCloseTo(0.25);
    expect(tableStatus({ ...all, waiterCalledAt: null, billRequestedAt: null, payments: [] }).indicator).toBe("kitchen");
  });

  it("a call from an empty table still shows", () => {
    expect(tableStatus(session({ orderCount: 0, waiterCalledAt: ago(1) }))).toMatchObject({ base: "free", indicator: "waiter" });
  });
});

describe("kitchen tickets", () => {
  const orders = [
    order({ id: "a", ticketNumber: 1, status: "pending", enteredMinutesAgo: 2 }),
    order({ id: "b", ticketNumber: 2, status: "accepted", enteredMinutesAgo: 25 }),
    order({ id: "c", ticketNumber: 3, status: "preparing", enteredMinutesAgo: 8 }),
    order({ id: "d", ticketNumber: 4, status: "preparing", enteredMinutesAgo: 12 }),
    order({ id: "e", ticketNumber: 5, status: "preparing", enteredMinutesAgo: 3 }),
    order({ id: "f", ticketNumber: 6, status: "ready", enteredMinutesAgo: 1 }),
    order({ id: "g", ticketNumber: 7, status: "out_for_delivery", channel: "delivery", enteredMinutesAgo: 1 }),
  ];

  it("groups by status, the longest waiting first, with «+N» past the limit", () => {
    const [pending, preparing, ready] = kitchenGroups(orders, NOW, 20);
    expect(pending!.tickets.map((t) => t.order.id)).toEqual(["a"]);
    expect(preparing!.tickets.map((t) => t.order.id)).toEqual(["b", "d", "c", "e"]);
    expect(preparing!.shown.map((t) => t.order.id)).toEqual(["b", "d", "c"]);
    expect(preparing!.hidden).toBe(1);
    expect(ready!.tickets.map((t) => t.order.id)).toEqual(["f"]);
  });

  it("the timer counts from the last status change and turns late at the goal", () => {
    const [, preparing] = kitchenGroups(orders, NOW, 20);
    expect(preparing!.tickets.map((t) => [t.minutes, t.late])).toEqual([
      [25, true],
      [12, false],
      [8, false],
      [3, false],
    ]);
    const [, strict] = kitchenGroups(orders, NOW, 12);
    expect(strict!.tickets[1]).toMatchObject({ minutes: 12, late: true });
    expect(timerLabel(8)).toBe("8 min");
    expect(timerLabel(75)).toBe("1 h 15 min");
  });

  it("names the customer, or counts the items of a table order", () => {
    expect(orderWho(order({ customerName: " Diego " }))).toBe("Diego");
    expect(orderWho(order())).toBe("2 ítems");
  });

  it("the pickup queue puts the ready bags first", () => {
    const list = [
      order({ id: "k", channel: "pickup", status: "preparing", enteredMinutesAgo: 9 }),
      order({ id: "r2", channel: "pickup", status: "ready", enteredMinutesAgo: 1 }),
      order({ id: "r1", channel: "pickup", status: "ready", enteredMinutesAgo: 4 }),
      order({ id: "t", channel: "dine_in", status: "ready" }),
    ];
    expect(pickupQueue(list).map((o) => o.id)).toEqual(["r1", "r2", "k"]);
  });
});

describe("tracking strip", () => {
  it("marks done, current and the estimate of the last step", () => {
    const delivery = order({
      channel: "delivery",
      status: "out_for_delivery",
      statusHistory: [
        { status: "pending", at: ago(20), byName: null },
        { status: "accepted", at: ago(19), byName: "Ana" },
        { status: "ready", at: ago(5), byName: "Ana" },
        { status: "out_for_delivery", at: ago(3), byName: "Rodrigo" },
      ],
      estimatedReadyAt: ago(-17),
    });
    const steps = trackingSteps(delivery);
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "done", "done", "current", "todo"]);
    // Skipped by the staff: done without a time.
    expect(steps[2]).toMatchObject({ status: "preparing", at: null });
    expect(steps[5]).toMatchObject({ status: "delivered", at: ago(-17), estimated: true });
  });

  it("table orders end in Servido; pickup estimates when it is ready", () => {
    expect(trackingSteps(order({ status: "preparing" })).map((s) => s.label)).toEqual(["Pendiente", "Aceptado", "En preparación", "Listo", "Servido"]);
    const pickup = trackingSteps(order({ channel: "pickup", status: "accepted", estimatedReadyAt: ago(-10) }));
    expect(pickup[3]).toMatchObject({ status: "ready", estimated: true, at: ago(-10) });
  });

  it("follows the last delivery that left, else the newest order", () => {
    const list = [
      order({ id: "t", createdAt: ago(1) }),
      order({ id: "d1", channel: "delivery", status: "out_for_delivery", enteredMinutesAgo: 9 }),
      order({ id: "d2", channel: "delivery", status: "out_for_delivery", enteredMinutesAgo: 2 }),
    ];
    expect(featuredOrder(list, true)?.id).toBe("d2");
    expect(featuredOrder(list, false)?.id).toBe("t");
    expect(featuredOrder([], true)).toBeNull();
  });
});

describe("selection", () => {
  it("round-trips through data-id keys", () => {
    for (const target of [{ kind: "kitchen" }, { kind: "door" }, { kind: "table", id: "abc123" }, { kind: "order", id: "f00" }] as const) {
      expect(parseTarget(targetKey(target))).toEqual(target);
    }
    expect(parseTarget("table:")).toBeNull();
    expect(parseTarget('table:x"]')).toBeNull();
  });

  it("falls back to the kitchen when the selected thing is gone", () => {
    const layout = liveLayout(view(PLAN, [TABLE_A]), { pickupEnabled: false, deliveryEnabled: true });
    expect(resolveTarget({ kind: "table", id: "t1" }, layout, [])).toEqual({ kind: "table", id: "t1" });
    expect(resolveTarget({ kind: "table", id: "zz" }, layout, [])).toEqual({ kind: "kitchen" });
    expect(resolveTarget({ kind: "order", id: "o1" }, layout, [order()])).toEqual({ kind: "order", id: "o1" });
    expect(resolveTarget({ kind: "order", id: "o9" }, layout, [order()])).toEqual({ kind: "kitchen" });
    expect(resolveTarget({ kind: "pickup" }, layout, [])).toEqual({ kind: "kitchen" });
    expect(resolveTarget({ kind: "door" }, layout, [])).toEqual({ kind: "door" });
    expect(resolveTarget(null, layout, [])).toEqual({ kind: "kitchen" });
  });
});

describe("indicators", () => {
  const summary: LiveSummary = {
    at: "2026-10-16T23:41:00.000Z",
    sales: { total: 1284560, currency: "CLP", changePercent: 12 },
    hourly: [
      { hour: 0, total: 0 },
      { hour: 1, total: 500 },
      { hour: 2, total: 1500 },
    ],
    inProgress: { dine_in: 6, pickup: 4, delivery: 0, total: 10 },
    kitchen: { averageMinutes: 17, targetMinutes: 20, sample: 9 },
    tables: { positioned: 8, occupied: 6, callingWaiter: 1, billRequested: 1, payingInParts: 0 },
  };

  it("compares with the same weekday last week in the restaurant's time zone", () => {
    // 23:41 UTC on Friday is 20:41 in Santiago (still Friday).
    expect(salesComparison(summary, "America/Santiago")).toEqual({ change: { text: "+12 %", trend: "up" }, text: "vs el viernes pasado" });
    expect(salesComparison({ ...summary, sales: { ...summary.sales, changePercent: null } }, "America/Santiago").text).toBe(
      "Sin ventas el viernes pasado a esta hora",
    );
    expect(changeLabel(-5)).toEqual({ text: "−5 %", trend: "down" });
    expect(changeLabel(0)).toEqual({ text: "0 %", trend: "flat" });
  });

  it("draws the running total of the day", () => {
    const spark = sparkline(summary.hourly, 150, 30);
    expect(spark?.line).toBe("M0.0,27.0 L75.0,21.0 L150.0,3.0");
    expect(spark?.area.endsWith("L150,30 L0,30 Z")).toBe(true);
    expect(sparkline([{ hour: 0, total: 0 }], 150, 30)).toBeNull();
    expect(sparkline([{ hour: 0, total: 0 }, { hour: 1, total: 0 }], 150, 30)?.line).toBe("M0.0,27.0 L150.0,27.0");
  });

  it("lists only the channels in use (or with orders)", () => {
    expect(inProgressBreakdown(summary.inProgress, ["dine_in", "pickup"]).text).toBe("6 mesa · 4 retiro");
    expect(inProgressBreakdown({ ...summary.inProgress, pickup: 0, delivery: 2 }, ["dine_in"]).text).toBe("6 mesa · 2 delivery");
  });

  it("the kitchen meter against its goal", () => {
    expect(kitchenGauge(summary.kitchen)).toEqual({ value: "17", status: "ok", text: "Meta 20 min · dentro de la meta", fillPercent: 56.7, targetPercent: 66.7 });
    expect(kitchenGauge({ ...summary.kitchen, averageMinutes: 40 })).toMatchObject({ status: "over", fillPercent: 100 });
    expect(kitchenGauge({ ...summary.kitchen, averageMinutes: null })).toMatchObject({ value: "—", status: "none", text: "Meta 20 min · sin pedidos listos hoy" });
  });

  it("the tables card", () => {
    expect(tablesSummary(summary.tables)).toEqual({ text: "1 llamado · 1 cuenta pedida", squares: [true, true, true, true, true, true, false, false] });
    expect(tablesSummary({ ...summary.tables, occupied: 0, callingWaiter: 0, billRequested: 0 }).text).toBe("Todas libres");
    expect(tablesSummary({ ...summary.tables, positioned: 40, occupied: 20 }).squares.filter(Boolean)).toHaveLength(8);
  });
});

describe("scene geometry", () => {
  it("paints the name on the longest free stretch of a back wall", () => {
    expect(nameSpot(PLAN)).toEqual({ wall: "north", start: 4, length: 7 });
    expect(nameSpot(defaultPlan(true, true))).toEqual({ wall: "north", start: 5, length: 3 });
    const blocked = { cols: 6, rows: 4, kitchen: { x: 0, y: 0, w: 6, h: 2 }, pickup: null, door: null };
    expect(nameSpot(blocked)).toEqual({ wall: "west", start: 2, length: 2 });
  });

  it("finds free corners for plants and room for «SALÓN»", () => {
    const tables = [{ rect: { x: 0, y: 8, w: 1, h: 1 } }];
    expect(freeCorners(PLAN, tables)).toEqual([]);
    expect(freeCorners({ ...PLAN, door: null }, [])).toEqual([
      { x: 0, y: 8 },
      { x: 13, y: 8 },
    ]);
    expect(diningLabelSpot(PLAN, tables)).toEqual({ x: 1, y: 8 });
  });

  it("knows the side of the door and leaves room for the street and the tickets", () => {
    expect(doorSide({ x: 13, y: 8 }, 14, 9)).toBe("east");
    expect(doorSide({ x: 4, y: 8 }, 14, 9)).toBe("south");
    expect(doorSide({ x: 0, y: 3 }, 14, 9)).toBe("west");
    expect(doorSide({ x: 4, y: 0 }, 14, 9)).toBe("north");
    const withDoor = sceneFrame(PLAN);
    const without = sceneFrame({ ...PLAN, door: null });
    expect(withDoor.viewBox.height).toBeGreaterThan(without.viewBox.height);
    // The tickets over the kitchen fit inside the viewBox.
    expect(withDoor.viewBox.y).toBeLessThan(withDoor.ticketsAnchor[1] - 150);
    expect(sceneFrame({ ...PLAN, cols: 24, rows: 16 }).overlayScale).toBeGreaterThan(1);
  });
});

describe("texts of the drawing", () => {
  it("short table labels, paying chips and ellipsis", async () => {
    const { ellipsize, payingChip, shortLabel } = await import("./live-floor");
    expect(shortLabel("Mesa 12")).toBe("12");
    expect(shortLabel("Terraza")).toBe("Terr");
    // Same short names as the floor plan editor: "Terraza 1" must not show as "1" next to "Mesa 1".
    expect(shortLabel("Terraza 1")).toBe("T1");
    expect(shortLabel(" B12 ")).toBe("B12");
    const payment = { id: "p", kind: "equal", amount: 100, tip: 0, method: "cash", part: 1, itemCount: 0, items: [], at: ago(1), byName: null } as TableSessionView["payments"][number];
    expect(payingChip(session())).toBeNull();
    expect(payingChip(session({ split: { mode: "equal", parts: 3 }, payments: [payment] }))).toBe("1/3 pagado");
    expect(payingChip(session({ payments: [{ ...payment, kind: "amount", part: null }], paid: 4000, remaining: 6000 }))).toBe("40 % pagado");
    expect(ellipsize("Fernanda Gutiérrez", 10)).toBe("Fernanda …");
    expect(ellipsize(" Ana ", 10)).toBe("Ana");
  });
});

describe("the whole view", () => {
  it("shows only the tabs that apply and maps accounts to tables", async () => {
    const { liveModel, statusTone } = await import("./live-floor");
    const restaurant = { pickupEnabled: false, deliveryEnabled: false, kitchenTargetMinutes: 20 };
    const base = { view: view(PLAN, [TABLE_A]), orders: [order({ tableSessionId: "s1" })], sessions: [session()], now: NOW };
    const plain = liveModel({ ...base, restaurant });
    expect(plain.tabs).toEqual(["kitchen"]);
    expect(plain.channels).toEqual(["dine_in"]);
    expect(plain.tableOfSession.get("s1")).toBe("t1");
    expect(plain.tableStates.get("t1")?.indicator).toBe("eating");
    expect(plain.layout).toMatchObject({ pickup: false, delivery: false });
    // A pickup order still open after turning pickup off keeps its tab (but no counter is drawn).
    const leftover = liveModel({ ...base, restaurant, orders: [order({ channel: "pickup" })] });
    expect(leftover.tabs).toEqual(["kitchen", "pickup"]);
    expect(leftover.layout.pickup).toBe(false);
    expect(liveModel({ ...base, restaurant: { ...restaurant, pickupEnabled: true, deliveryEnabled: true } }).tabs).toEqual(["kitchen", "pickup", "delivery"]);
    expect(statusTone("pending")).toBe("warn");
    expect(statusTone("out_for_delivery")).toBe("rid");
  });
});
