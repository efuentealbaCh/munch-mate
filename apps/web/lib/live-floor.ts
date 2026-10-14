import {
  type FloorCell,
  type FloorPlan,
  type FloorPlanView,
  type FloorRect,
  type LiveSummary,
  ORDER_STATUS_LABELS,
  type OrderChannel,
  type OrderStatus,
  type OrderView,
  type TableLayout,
  type TableSessionView,
} from "@app/types";
import { tableFootprint } from "@app/utils";
import { shortTableLabel } from "./floor-editor";
import { formatPrice } from "./money";
import { minutesSince } from "./orders-board";

/**
 * «En vivo» (phase 9): the restaurant drawn isometrically for the owner and the cashier. Everything here is
 * pure (no DOM): the projection and paint order of the scene, which zones are drawn, each table's state from
 * its open account, the kitchen tickets and their timers, and the texts of the indicators.
 */

// ── Isometric projection ────────────────────────────────────────────────────

/** Screen pixels per world unit (before the SVG viewBox scales the scene to its box). */
export const ISO_UNIT = 14;
/** World units per cell of the floor plan grid. */
export const CELL = 4;
const COS30 = Math.cos(Math.PI / 6);

/** A point of the world: x along the columns, y along the rows, z up (world units). */
export type Vec3 = readonly [x: number, y: number, z?: number];

/**
 * Isometric projection with both floor axes at 30°: +x goes down-right on screen, +y down-left, +z up. The
 * back walls are the x = 0 and y = 0 edges; what has a bigger x + y is closer to the viewer.
 * @returns Screen [x, y] in pixels.
 */
export function project(x: number, y: number, z = 0): [number, number] {
  return [(x - y) * COS30 * ISO_UNIT, ((x + y) * ISO_UNIT) / 2 - z * ISO_UNIT];
}

/** One decimal, enough for SVG coordinates (keeps the markup small). */
export function r1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** `points` attribute of a polygon through world points. */
export function isoPoints(points: readonly Vec3[]): string {
  return points
    .map(([x, y, z]) => {
      const [px, py] = project(x, y, z ?? 0);
      return `${r1(px)},${r1(py)}`;
    })
    .join(" ");
}

/** Darkens a #rrggbb color by `amount` (0–1). */
export function shade(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  return `#${[0, 2, 4]
    .map((i) => {
      const channel = Math.round(Number.parseInt(value.slice(i, i + 2), 16) * (1 - amount));
      return Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0");
    })
    .join("")}`;
}

/** Colors of the three visible faces of a box: top, left (+y face) and right (+x face). */
export interface Tone {
  t: string;
  l: string;
  r: string;
}

export function tone(base: string, left = 0.06, right = 0.14): Tone {
  return { t: base, l: shade(base, left), r: shade(base, right) };
}

/**
 * A closed ellipse on a horizontal plane (semi-axes `a` along x and `b` along y, world units), as a polygon
 * path plus its length (for progress rings drawn with stroke-dasharray). Starts at the back (−y) and goes
 * clockwise on screen.
 */
export function floorEllipse(cx: number, cy: number, a: number, b: number, z = 0, segments = 48): { d: string; length: number } {
  let d = "";
  let length = 0;
  let previous: [number, number] | null = null;
  for (let i = 0; i <= segments; i++) {
    const angle = -Math.PI / 2 + (i / segments) * Math.PI * 2;
    const point = project(cx + a * Math.cos(angle), cy + b * Math.sin(angle), z);
    d += `${i === 0 ? "M" : "L"}${r1(point[0])},${r1(point[1])} `;
    if (previous) length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return { d: `${d.trim()} Z`, length };
}

/** Outline of a floor rectangle (world units), as a path. */
export function floorRectPath(x: number, y: number, w: number, h: number, z = 0): string {
  return `M${isoPoints([
    [x, y, z],
    [x + w, y, z],
    [x + w, y + h, z],
    [x, y + h, z],
  ]).replace(/ /g, " L")} Z`;
}

// ── Paint order ─────────────────────────────────────────────────────────────

/** A rectangle of whole cells (same shape as FloorRect). */
export type GridRect = FloorRect;

/** Horizontal screen span of a rectangle (proportional to x − y). */
function screenSpan(rect: GridRect): [number, number] {
  return [rect.x - (rect.y + rect.h), rect.x + rect.w - rect.y];
}

/**
 * Whether `a` must be painted before `b`: it lies entirely behind it along x or y and both share some
 * horizontal screen span (otherwise they never cover each other and the order does not matter).
 */
export function paintsBefore(a: GridRect, b: GridRect): boolean {
  const [a0, a1] = screenSpan(a);
  const [b0, b1] = screenSpan(b);
  if (a1 <= b0 || b1 <= a0) return false;
  return a.x + a.w <= b.x || a.y + a.h <= b.y;
}

/**
 * Painter's order for objects standing on disjoint cell rectangles. Sorting by the center's x + y fails with
 * long objects (a 1 × 6 counter and a table in front of its middle), so this is a topological sort over
 * {@link paintsBefore}, picking the nearest-to-the-back object first among the free ones (stable output).
 */
export function paintOrder<T>(items: readonly T[], rectOf: (item: T) => GridRect): T[] {
  const rects = items.map(rectOf);
  const depth = rects.map((r) => r.x + r.w / 2 + r.y + r.h / 2);
  const blockers = items.map(() => 0);
  const after: number[][] = items.map(() => []);
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (i !== j && paintsBefore(rects[i]!, rects[j]!) && !paintsBefore(rects[j]!, rects[i]!)) {
        after[i]!.push(j);
        blockers[j]! += 1;
      }
    }
  }
  const done = items.map(() => false);
  const order: T[] = [];
  for (let step = 0; step < items.length; step++) {
    let pick = -1;
    for (let i = 0; i < items.length; i++) {
      if (done[i] || blockers[i]! > 0) continue;
      if (pick === -1 || depth[i]! < depth[pick]!) pick = i;
    }
    // A cycle cannot happen with disjoint rectangles; if it ever did, fall back to the nearest one.
    if (pick === -1) {
      for (let i = 0; i < items.length; i++) if (!done[i] && (pick === -1 || depth[i]! < depth[pick]!)) pick = i;
    }
    done[pick] = true;
    order.push(items[pick]!);
    for (const j of after[pick]!) blockers[j]! -= 1;
  }
  return order;
}

// ── Which zones are drawn ───────────────────────────────────────────────────

/** A table drawn on the plan. */
export interface PlacedTable {
  id: string;
  label: string;
  layout: TableLayout;
  /** Cells it takes (tableFootprint). */
  rect: GridRect;
}

export interface LiveLayout {
  /** What is drawn: the owner's plan (or the default scene), without the zones the restaurant does not use. */
  plan: FloorPlan;
  /** Whether the owner drew a plan (false = default scene with only the kitchen and the enabled zones). */
  hasPlan: boolean;
  /** Dining room: a plan with at least one active table placed on it. */
  dining: boolean;
  /** Pickup counter: `pickupEnabled` and (with a plan) a counter on it. */
  pickup: boolean;
  /** Delivery door and riders mini-map: `deliveryEnabled` and (with a plan) a door on it. */
  delivery: boolean;
  tables: PlacedTable[];
}

/**
 * Scene used before the owner draws the plan: the kitchen and, when enabled, the pickup counter below it and
 * the delivery door on the front edge (a free column on the right keeps the restaurant's name and the door).
 * Valid for `floorPlanProblem`.
 */
export function defaultPlan(pickup: boolean, delivery: boolean): FloorPlan {
  const rows = pickup ? 7 : 5;
  return {
    cols: 8,
    rows,
    kitchen: { x: 0, y: 0, w: 5, h: 4 },
    pickup: pickup ? { x: 0, y: 4, w: 5, h: 3 } : null,
    door: delivery ? { x: 7, y: rows - 1 } : null,
  };
}

/**
 * What the live view draws. Each zone only when the restaurant uses it: no plan or no active placed table →
 * no dining room; pickup off or no counter on the plan → no counter; delivery off or no door → no door nor
 * mini-map. The kitchen is always drawn (default scene without a plan).
 */
export function liveLayout(
  view: FloorPlanView | null,
  restaurant: { pickupEnabled: boolean; deliveryEnabled: boolean },
): LiveLayout {
  const own = view?.plan ?? null;
  const base = own ?? defaultPlan(restaurant.pickupEnabled, restaurant.deliveryEnabled);
  const pickup = restaurant.pickupEnabled && base.pickup !== null;
  const delivery = restaurant.deliveryEnabled && base.door !== null;
  const tables: PlacedTable[] =
    own && view
      ? view.tables.flatMap((table) =>
          table.active && table.layout ? [{ id: table.id, label: table.label, layout: table.layout, rect: tableFootprint(table.layout) }] : [],
        )
      : [];
  return {
    plan: { ...base, pickup: pickup ? base.pickup : null, door: delivery ? base.door : null },
    hasPlan: own !== null,
    dining: tables.length > 0,
    pickup,
    delivery,
    tables,
  };
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** Color of the table top: nobody, waiting for the kitchen, or served. */
export type TableBase = "free" | "kitchen" | "eating";
/** What the table's pin shows (the most urgent of its states). */
export type TableIndicator = "waiter" | "bill" | "paying" | TableBase;

export const TABLE_STATE_LABELS: Record<TableIndicator, string> = {
  free: "Libre",
  kitchen: "Pedido en cocina",
  eating: "Comiendo",
  waiter: "Llamó al garzón",
  bill: "Pidió la cuenta",
  paying: "Pagando por partes",
};

/** Scene colors (the SVG paints plain colors; same palette as the approved mock-up). */
export const TABLE_COLORS: Record<TableBase, { top: string; side: string; badge: string }> = {
  free: { top: "#efedeb", side: "#d6d3d1", badge: "#a8a29e" },
  kitchen: { top: "#fbd9c4", side: "#eab08f", badge: "#c2410c" },
  eating: { top: "#cdebd6", side: "#97cca8", badge: "#15803d" },
};
export const ALERT_COLORS = { waiter: "#d97706", bill: "#c2410c", paying: "#15803d" } as const;

export interface TableStatus {
  base: TableBase;
  indicator: TableIndicator;
  /** Every state that applies (a table may call the waiter while paying in parts). */
  waiter: boolean;
  bill: boolean;
  paying: boolean;
  /** Since when the indicator applies: the call, the bill request or when the account opened; null when free. */
  since: string | null;
  /** Share paid of the account (0–1) while paying in parts; null otherwise. */
  paidFraction: number | null;
  session: TableSessionView | null;
}

/**
 * State of a table from its open account. Priority of the pin when several apply: called the waiter > asked
 * for the bill > paying in parts > order in the kitchen > eating.
 */
export function tableStatus(session: TableSessionView | null | undefined): TableStatus {
  const open = session && session.status === "open" ? session : null;
  if (!open) return { base: "free", indicator: "free", waiter: false, bill: false, paying: false, since: null, paidFraction: null, session: null };
  const base: TableBase = open.ordersInProgress > 0 ? "kitchen" : open.orderCount > 0 ? "eating" : "free";
  const waiter = open.waiterCalledAt !== null;
  const bill = open.billRequestedAt !== null;
  const paying = open.payments.length > 0;
  const indicator: TableIndicator = waiter ? "waiter" : bill ? "bill" : paying ? "paying" : base;
  const total = open.paid + open.remaining;
  return {
    base,
    indicator,
    waiter,
    bill,
    paying,
    since: waiter ? open.waiterCalledAt : bill ? open.billRequestedAt : base === "free" && !paying ? null : open.openedAt,
    paidFraction: paying ? (total > 0 ? Math.min(1, open.paid / total) : 1) : null,
    session: open,
  };
}

/**
 * What the table's badge shows, the same short name as the floor plan editor ("Mesa 12" → "12", "Terraza 3" →
 * "T3", so "Terraza 1" never looks like "Mesa 1"), cut to 4 characters for the small badge.
 */
export function shortLabel(label: string): string {
  return shortTableLabel(label.trim()).slice(0, 4);
}

/**
 * Chip next to a table paying in parts: "1/3 pagado" with equal parts, else the share paid ("40 % pagado").
 * @returns null when the account has no payments.
 */
export function payingChip(session: Pick<TableSessionView, "payments" | "split" | "paid" | "remaining">): string | null {
  if (session.payments.length === 0) return null;
  if (session.split?.mode === "equal") {
    const parts = new Set(session.payments.flatMap((p) => (p.kind === "equal" && p.part !== null ? [p.part] : []))).size;
    if (parts > 0) return `${parts}/${session.split.parts} pagado`;
  }
  const total = session.paid + session.remaining;
  return `${total > 0 ? Math.min(100, Math.round((session.paid / total) * 100)) : 100} % pagado`;
}

/** Shortens a text for the drawing (SVG text does not wrap): "Fernanda Gutiérrez" → "Fernanda Gutié…". */
export function ellipsize(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join("")}…` : chars.join("");
}

/** Open accounts by table id (closed ones are ignored). */
export function sessionsByTable(sessions: readonly TableSessionView[]): Map<string, TableSessionView> {
  const map = new Map<string, TableSessionView>();
  for (const session of sessions) if (session.status === "open") map.set(session.tableId, session);
  return map;
}

// ── Kitchen tickets ─────────────────────────────────────────────────────────

export type KitchenGroupKey = "pending" | "preparing" | "ready";

export const KITCHEN_GROUPS: readonly { key: KitchenGroupKey; label: string; color: string; statuses: readonly OrderStatus[] }[] = [
  { key: "pending", label: "Pendiente", color: "#b45309", statuses: ["pending"] },
  // Accepted orders are already the kitchen's: they wait with the ones being prepared.
  { key: "preparing", label: "En preparación", color: "#c2410c", statuses: ["accepted", "preparing"] },
  { key: "ready", label: "Listo", color: "#15803d", statuses: ["ready"] },
];

/** Tickets shown per group over the kitchen; the rest are summarized as «+N». */
export const TICKETS_PER_GROUP = 3;

/** When the order entered its current status (the last entry of its history). */
export function statusSince(order: Pick<OrderView, "statusHistory" | "createdAt">): string {
  return order.statusHistory.at(-1)?.at ?? order.createdAt;
}

/** Units of an order (Σ quantities). */
export function unitCount(order: Pick<OrderView, "items">): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** "Mesa 4", "Retiro" or "Delivery". */
export function channelPlace(order: Pick<OrderView, "channel" | "tableLabel">): string {
  if (order.channel === "dine_in") return order.tableLabel ?? "Mesa";
  return order.channel === "pickup" ? "Retiro" : "Delivery";
}

/** The customer's name, or "3 ítems" when there is none (table orders). */
export function orderWho(order: Pick<OrderView, "customerName" | "items">): string {
  const name = order.customerName.trim();
  if (name) return name;
  const units = unitCount(order);
  return `${units} ${units === 1 ? "ítem" : "ítems"}`;
}

export interface KitchenTicket {
  order: OrderView;
  /** Whole minutes in its current status (the ticket's timer). */
  minutes: number;
  /** The timer went over the kitchen goal. */
  late: boolean;
}

export interface KitchenGroup {
  key: KitchenGroupKey;
  label: string;
  color: string;
  /** Oldest first: the one waiting the longest leads. */
  tickets: KitchenTicket[];
  /** The first TICKETS_PER_GROUP. */
  shown: KitchenTicket[];
  /** How many more («+N»). */
  hidden: number;
}

/** A ticket's timer against the kitchen goal. */
export function ticketTimer(order: Pick<OrderView, "statusHistory" | "createdAt">, now: number, targetMinutes: number): { minutes: number; late: boolean } {
  const minutes = minutesSince(statusSince(order), now);
  return { minutes, late: minutes >= targetMinutes };
}

/**
 * Active orders grouped as the kitchen sees them: Pendiente, En preparación (accepted or preparing) and
 * Listo; each oldest first, with its timer.
 */
export function kitchenGroups(orders: readonly OrderView[], now: number, targetMinutes: number, perGroup = TICKETS_PER_GROUP): KitchenGroup[] {
  return KITCHEN_GROUPS.map((group) => {
    const tickets = orders
      .filter((order) => group.statuses.includes(order.status))
      .sort((a, b) => statusSince(a).localeCompare(statusSince(b)) || a.ticketNumber - b.ticketNumber)
      .map((order) => ({ order, ...ticketTimer(order, now, targetMinutes) }));
    return {
      key: group.key,
      label: group.label,
      color: group.color,
      tickets,
      shown: tickets.slice(0, perGroup),
      hidden: Math.max(0, tickets.length - perGroup),
    };
  });
}

/** "8 min" (the ticket timer). */
export function timerLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Orders of the kitchen (pending to ready), any channel. */
export function inKitchen(orders: readonly OrderView[]): OrderView[] {
  return orders.filter((order) => KITCHEN_GROUPS.some((group) => group.statuses.includes(order.status)));
}

/** Pickup orders waiting on the counter, the oldest first. */
export function readyPickups(orders: readonly OrderView[]): OrderView[] {
  return orders
    .filter((order) => order.channel === "pickup" && order.status === "ready")
    .sort((a, b) => statusSince(a).localeCompare(statusSince(b)));
}

/** Active pickup orders: ready ones first, then the ones still in the kitchen (oldest first). */
export function pickupQueue(orders: readonly OrderView[]): OrderView[] {
  const rest = orders
    .filter((order) => order.channel === "pickup" && order.status !== "ready")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...readyPickups(orders), ...rest];
}

/** Deliveries on their way (one motorbike each at the door), the earliest to leave first. */
export function onTheWay(orders: readonly OrderView[]): OrderView[] {
  return orders
    .filter((order) => order.channel === "delivery" && order.status === "out_for_delivery")
    .sort((a, b) => statusSince(a).localeCompare(statusSince(b)));
}

/** Active deliveries: on their way, then ready to leave, then in the kitchen. */
export function deliveryQueue(orders: readonly OrderView[]): OrderView[] {
  const rank = (status: OrderStatus) => (status === "out_for_delivery" ? 0 : status === "ready" ? 1 : 2);
  return orders
    .filter((order) => order.channel === "delivery")
    .sort((a, b) => rank(a.status) - rank(b.status) || statusSince(a).localeCompare(statusSince(b)));
}

// ── Order tracking (the strip under the scene) ──────────────────────────────

const FLOWS: Record<OrderChannel, readonly OrderStatus[]> = {
  dine_in: ["pending", "accepted", "preparing", "ready", "served"],
  pickup: ["pending", "accepted", "preparing", "ready", "picked_up"],
  delivery: ["pending", "accepted", "preparing", "ready", "out_for_delivery", "delivered"],
};

export interface TrackingStep {
  status: OrderStatus;
  label: string;
  state: "done" | "current" | "todo";
  /** When it happened (last time it entered that status), or the estimate for a future step; null if unknown. */
  at: string | null;
  /** `at` is the estimate given when accepting (pickup ready / delivery arrival). */
  estimated: boolean;
}

/** The steps of an order's channel with what already happened. Steps skipped by the staff count as done. */
export function trackingSteps(order: Pick<OrderView, "channel" | "status" | "statusHistory" | "estimatedReadyAt">): TrackingStep[] {
  const flow = FLOWS[order.channel];
  const current = flow.indexOf(order.status);
  const reached = new Map<OrderStatus, string>();
  for (const change of order.statusHistory) reached.set(change.status, change.at);
  const estimateStep: OrderStatus = order.channel === "delivery" ? "delivered" : order.channel === "pickup" ? "ready" : "served";
  return flow.map((status, index) => {
    const state = current === -1 ? (reached.has(status) ? "done" : "todo") : index < current ? "done" : index === current ? "current" : "todo";
    const estimated = state === "todo" && status === estimateStep && order.estimatedReadyAt !== null && order.channel !== "dine_in";
    return {
      status,
      label: ORDER_STATUS_LABELS[status],
      state,
      at: state === "todo" ? (estimated ? order.estimatedReadyAt : null) : (reached.get(status) ?? null),
      estimated,
    };
  });
}

/**
 * The order the tracking strip follows when nothing is selected: with delivery, the delivery that left last
 * (else the newest active delivery); otherwise, or without deliveries, the newest active order of any channel.
 */
export function featuredOrder(orders: readonly OrderView[], delivery: boolean): OrderView | null {
  const newest = (list: readonly OrderView[], key: (order: OrderView) => string) =>
    list.reduce<OrderView | null>((best, order) => (best === null || key(order) > key(best) ? order : best), null);
  if (delivery) {
    const out = newest(onTheWay(orders), statusSince);
    if (out) return out;
    const any = newest(
      orders.filter((order) => order.channel === "delivery"),
      (order) => order.createdAt,
    );
    if (any) return any;
  }
  return newest(orders, (order) => order.createdAt);
}

// ── Selection ───────────────────────────────────────────────────────────────

/** What the detail panel shows; also the `data-id` of the scene's elements. */
export type LiveTarget = { kind: "kitchen" } | { kind: "pickup" } | { kind: "door" } | { kind: "table"; id: string } | { kind: "order"; id: string };

export function targetKey(target: LiveTarget): string {
  return target.kind === "table" || target.kind === "order" ? `${target.kind}:${target.id}` : target.kind;
}

export function parseTarget(key: string | null | undefined): LiveTarget | null {
  if (key === "kitchen" || key === "pickup" || key === "door") return { kind: key };
  const match = /^(table|order):([\w-]+)$/.exec(key ?? "");
  if (!match) return null;
  return { kind: match[1] as "table" | "order", id: match[2]! };
}

/**
 * Keeps the selection while it still exists (a table on the plan, an active order, a drawn zone); otherwise
 * falls back to the kitchen, which is always there.
 */
export function resolveTarget(target: LiveTarget | null, layout: LiveLayout, orders: readonly OrderView[]): LiveTarget {
  if (!target) return { kind: "kitchen" };
  switch (target.kind) {
    case "table":
      return layout.tables.some((t) => t.id === target.id) ? target : { kind: "kitchen" };
    case "order":
      return orders.some((o) => o.id === target.id) ? target : { kind: "kitchen" };
    case "pickup":
      return layout.pickup ? target : { kind: "kitchen" };
    case "door":
      return layout.delivery ? target : { kind: "kitchen" };
    default:
      return target;
  }
}

// ── Indicators ──────────────────────────────────────────────────────────────

/** "+12 %", "−5 %", "0 %" against last week; null without sales then. */
export function changeLabel(changePercent: number | null): { text: string; trend: "up" | "down" | "flat" } | null {
  if (changePercent === null) return null;
  if (changePercent > 0) return { text: `+${changePercent} %`, trend: "up" };
  if (changePercent < 0) return { text: `−${Math.abs(changePercent)} %`, trend: "down" };
  return { text: "0 %", trend: "flat" };
}

/** Weekday of an instant in the restaurant's time zone ("viernes"). */
export function weekdayName(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-CL", { weekday: "long", timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("es-CL", { weekday: "long" }).format(new Date(iso));
  }
}

/** Subtitle of the sales card: "+12 % vs el viernes pasado" (or why there is no comparison). */
export function salesComparison(summary: Pick<LiveSummary, "at" | "sales">, timeZone: string): { change: ReturnType<typeof changeLabel>; text: string } {
  const day = weekdayName(summary.at, timeZone);
  const change = changeLabel(summary.sales.changePercent);
  return change ? { change, text: `vs el ${day} pasado` } : { change: null, text: `Sin ventas el ${day} pasado a esta hora` };
}

/**
 * Sparkline of today's sales so far (running total per hour) in a `width × height` box.
 * @returns The line and the filled area paths; null with fewer than two hours.
 */
export function sparkline(hourly: readonly { hour: number; total: number }[], width: number, height: number): { line: string; area: string } | null {
  if (hourly.length < 2) return null;
  let running = 0;
  const cumulative = hourly.map((h) => (running += h.total));
  const max = Math.max(...cumulative);
  const points = cumulative.map((value, i) => [
    (i * width) / (cumulative.length - 1),
    height - 3 - (max > 0 ? (value / max) * (height - 6) : 0),
  ]);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x!.toFixed(1)},${y!.toFixed(1)}`).join(" ");
  return { line, area: `${line} L${width},${height} L0,${height} Z` };
}

export const CHANNEL_SHORT: Record<OrderChannel, string> = { dine_in: "mesa", pickup: "retiro", delivery: "delivery" };
export const CHANNEL_COLORS: Record<OrderChannel, string> = { dine_in: "#c2410c", pickup: "#d97706", delivery: "#2563eb" };

/**
 * Orders in progress per channel for the card: only the channels the restaurant uses (or that still have
 * orders), e.g. "6 mesa · 4 retiro · 4 delivery".
 */
export function inProgressBreakdown(
  inProgress: LiveSummary["inProgress"],
  channels: readonly OrderChannel[],
): { parts: { channel: OrderChannel; count: number; color: string }[]; text: string } {
  const parts = (["dine_in", "pickup", "delivery"] as const)
    .filter((channel) => channels.includes(channel) || inProgress[channel] > 0)
    .map((channel) => ({ channel, count: inProgress[channel], color: CHANNEL_COLORS[channel] }));
  return { parts, text: parts.map((p) => `${p.count} ${CHANNEL_SHORT[p.channel]}`).join(" · ") };
}

/** The kitchen card: average against the goal, as a meter whose full width is 1.5 × the goal. */
export function kitchenGauge(kitchen: LiveSummary["kitchen"]): {
  value: string;
  status: "ok" | "over" | "none";
  text: string;
  fillPercent: number;
  targetPercent: number;
} {
  const scale = kitchen.targetMinutes * 1.5;
  const targetPercent = Math.round((kitchen.targetMinutes / scale) * 1000) / 10;
  if (kitchen.averageMinutes === null) {
    return { value: "—", status: "none", text: `Meta ${kitchen.targetMinutes} min · sin pedidos listos hoy`, fillPercent: 0, targetPercent };
  }
  const over = kitchen.averageMinutes > kitchen.targetMinutes;
  return {
    value: String(kitchen.averageMinutes),
    status: over ? "over" : "ok",
    text: `Meta ${kitchen.targetMinutes} min · ${over ? "sobre la meta" : "dentro de la meta"}`,
    fillPercent: Math.min(100, Math.round((kitchen.averageMinutes / scale) * 1000) / 10),
    targetPercent,
  };
}

/** Tables card: "1 llamado · 1 cuenta pedida · 1 pagando por partes" and one square per placed table (max 16). */
export function tablesSummary(tables: LiveSummary["tables"]): { text: string; squares: boolean[] } {
  const parts = [
    tables.callingWaiter > 0 ? `${tables.callingWaiter} ${tables.callingWaiter === 1 ? "llamado" : "llamados"}` : null,
    tables.billRequested > 0 ? `${tables.billRequested} ${tables.billRequested === 1 ? "cuenta pedida" : "cuentas pedidas"}` : null,
    tables.payingInParts > 0 ? `${tables.payingInParts} pagando por partes` : null,
  ].filter((p): p is string => p !== null);
  const text = parts.length > 0 ? parts.join(" · ") : tables.occupied === 0 ? "Todas libres" : "Sin llamados";
  const shown = Math.min(16, tables.positioned);
  const on = tables.positioned > 0 ? Math.round((Math.min(tables.occupied, tables.positioned) / tables.positioned) * shown) : 0;
  return { text, squares: Array.from({ length: shown }, (_, i) => i < on) };
}

/** "$1.284.560": money of the indicators. */
export function moneyLabel(amount: number, currency: string): string {
  return formatPrice(amount, currency);
}

// ── Scene geometry ──────────────────────────────────────────────────────────

/** Size of the kitchen drawing (world units), as in the approved mock-up; scaled to fit the plan's kitchen. */
export const KITCHEN_ART = { w: 15.6, h: 12 } as const;
/** Size of the pickup counter drawing (world units). */
export const PICKUP_ART = { w: 15, h: 9 } as const;
/** Scale of the table drawings (the mock-up's tables) so a table with its chairs fits one cell. */
export const TABLE_SCALE = 0.78;
/** Height of the back walls (world units). */
export const WALL_HEIGHT = 4;

/** Where a drawing goes in the world: its origin and its uniform scale. */
export interface ArtPlacement {
  x: number;
  y: number;
  scale: number;
}

/**
 * Fits a drawing into a rectangle of cells with one uniform scale (a projected drawing scaled uniformly is
 * still isometric), centered along x and either centered or against the back (low y) along y.
 */
export function fitArt(rect: GridRect, art: { w: number; h: number }, align: "center" | "back", maxScale = 1.25): ArtPlacement {
  const width = rect.w * CELL;
  const depth = rect.h * CELL;
  const scale = Math.min(width / art.w, depth / art.h, maxScale);
  return {
    x: rect.x * CELL + (width - art.w * scale) / 2,
    y: rect.y * CELL + (align === "back" ? 0 : (depth - art.h * scale) / 2),
    scale,
  };
}

/** Screen point of a point of a placed drawing (local world units). */
export function artPoint(placement: ArtPlacement, x: number, y: number, z = 0): [number, number] {
  return project(placement.x + x * placement.scale, placement.y + y * placement.scale, z * placement.scale);
}

/** Which edge the delivery door is on: the front ones (east = last column, south = last row) win at corners. */
export type DoorSide = "east" | "south" | "west" | "north";

export function doorSide(door: FloorCell, cols: number, rows: number): DoorSide {
  if (door.x === cols - 1) return "east";
  if (door.y === rows - 1) return "south";
  if (door.x === 0) return "west";
  return "north";
}

/** Cells taken by areas, the door and tables ("x,y" keys). */
export function takenCells(plan: FloorPlan, tables: readonly { rect: GridRect }[]): Set<string> {
  const taken = new Set<string>();
  const add = (rect: GridRect) => {
    for (let x = rect.x; x < rect.x + rect.w; x++) for (let y = rect.y; y < rect.y + rect.h; y++) taken.add(`${x},${y}`);
  };
  add(plan.kitchen);
  if (plan.pickup) add(plan.pickup);
  if (plan.door) add({ ...plan.door, w: 1, h: 1 });
  for (const table of tables) add(table.rect);
  return taken;
}

/** Longest run of indices in [0, length) for which `free` holds. */
function longestRun(length: number, free: (i: number) => boolean): { start: number; length: number } {
  let best = { start: 0, length: 0 };
  let start = -1;
  for (let i = 0; i <= length; i++) {
    if (i < length && free(i)) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start > best.length) best = { start, length: i - start };
      start = -1;
    }
  }
  return best;
}

/**
 * Where the restaurant's name is painted: the longest stretch of a back wall (north = y 0, west = x 0) with no
 * kitchen or counter against it (their drawings are tall). In cells.
 */
export function nameSpot(plan: FloorPlan): { wall: "north" | "west"; start: number; length: number } | null {
  const areas = [plan.kitchen, ...(plan.pickup ? [plan.pickup] : [])];
  const against = (x: number, y: number) => areas.some((a) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h);
  const doorAt = (x: number, y: number) => plan.door !== null && plan.door.x === x && plan.door.y === y;
  const north = longestRun(plan.cols, (x) => !against(x, 0) && !doorAt(x, 0));
  const west = longestRun(plan.rows, (y) => !against(0, y) && !doorAt(0, y));
  if (north.length === 0 && west.length === 0) return null;
  return north.length >= west.length ? { wall: "north", ...north } : { wall: "west", ...west };
}

/** Free corner cells (for plants), never the door's. */
export function freeCorners(plan: FloorPlan, tables: readonly { rect: GridRect }[]): FloorCell[] {
  const taken = takenCells(plan, tables);
  const corners: FloorCell[] = [
    { x: 0, y: 0 },
    { x: plan.cols - 1, y: 0 },
    { x: 0, y: plan.rows - 1 },
    { x: plan.cols - 1, y: plan.rows - 1 },
  ];
  return corners.filter((cell) => !taken.has(`${cell.x},${cell.y}`));
}

/** First run of at least 3 free cells on the last row, where «SALÓN» is painted on the floor; null if none. */
export function diningLabelSpot(plan: FloorPlan, tables: readonly { rect: GridRect }[]): FloorCell | null {
  const taken = takenCells(plan, tables);
  const y = plan.rows - 1;
  let run = 0;
  for (let x = 0; x < plan.cols; x++) {
    run = taken.has(`${x},${y}`) ? 0 : run + 1;
    if (run === 3) return { x: x - 2, y };
  }
  return null;
}

/** Tallest ticket group (header + 3 tickets + «+N»), for the room reserved above the kitchen. */
export const TICKET_GROUP = { width: 112, gap: 10, header: 24, row: 38, more: 16 } as const;
export const TICKET_STACK_HEIGHT = TICKET_GROUP.header + TICKETS_PER_GROUP * TICKET_GROUP.row + TICKET_GROUP.more;

export interface SceneFrame {
  /** World size of the grid. */
  width: number;
  depth: number;
  viewBox: { x: number; y: number; width: number; height: number };
  /**
   * Scale of labels, pins and tickets: big plans are scaled down to fit, so their overlays grow to keep a
   * readable size on screen.
   */
  overlayScale: number;
  /** Bottom-center of the ticket groups over the kitchen (screen). */
  ticketsAnchor: [number, number];
}

/** The viewBox that holds the building, the street outside a front door and the tickets over the kitchen. */
export function sceneFrame(plan: FloorPlan): SceneFrame {
  const width = plan.cols * CELL;
  const depth = plan.rows * CELL;
  const points: [number, number][] = [
    project(-0.6, -0.6, WALL_HEIGHT),
    project(width + 0.6, -0.6, WALL_HEIGHT),
    project(-0.6, depth + 0.6, WALL_HEIGHT),
    project(width + 0.6, depth + 0.6, -1),
  ];
  if (plan.door) {
    const side = doorSide(plan.door, plan.cols, plan.rows);
    const cx = (plan.door.x + 0.5) * CELL;
    const cy = (plan.door.y + 0.5) * CELL;
    if (side === "east") points.push(project(width + 7, cy - 5, 0), project(width + 7, cy + 7, -1));
    if (side === "south") points.push(project(cx - 5, depth + 7, 0), project(cx + 7, depth + 7, -1));
  }
  let minX = Math.min(...points.map((p) => p[0]));
  let maxX = Math.max(...points.map((p) => p[0]));
  let minY = Math.min(...points.map((p) => p[1]));
  const maxY = Math.max(...points.map((p) => p[1]));
  const overlayScale = Math.min(2.2, Math.max(1, (maxX - minX) / 1000));

  const k = plan.kitchen;
  const anchor = project((k.x + k.w / 2) * CELL, (k.y + k.h / 2) * CELL, WALL_HEIGHT + 1);
  const ticketsAnchor: [number, number] = [anchor[0], anchor[1] - 34 * overlayScale];
  const stackWidth = (TICKET_GROUP.width * 3 + TICKET_GROUP.gap * 2) * overlayScale;
  minX = Math.min(minX, ticketsAnchor[0] - stackWidth / 2);
  maxX = Math.max(maxX, ticketsAnchor[0] + stackWidth / 2);
  minY = Math.min(minY, ticketsAnchor[1] - TICKET_STACK_HEIGHT * overlayScale);

  const pad = 20 * overlayScale;
  return {
    width,
    depth,
    viewBox: { x: r1(minX - pad), y: r1(minY - pad), width: r1(maxX - minX + pad * 2), height: r1(maxY - minY + pad * 2) },
    overlayScale,
    ticketsAnchor,
  };
}

// ── The whole view ──────────────────────────────────────────────────────────

/** Tabs of the work queue. */
export type QueueTab = "kitchen" | "pickup" | "delivery";

/** Chip color of an order status (the mock-up's chips). */
export type ChipTone = "ok" | "warn" | "pri" | "neu" | "rid";

export function statusTone(status: OrderStatus): ChipTone {
  if (status === "pending") return "warn";
  if (status === "accepted" || status === "preparing") return "pri";
  if (status === "ready") return "ok";
  if (status === "out_for_delivery") return "rid";
  return "neu";
}

export interface LiveModel {
  layout: LiveLayout;
  orders: OrderView[];
  /** Open account of each table, by table id. */
  sessionsByTable: Map<string, TableSessionView>;
  tableStates: Map<string, TableStatus>;
  /** Table id of each open account (orders point at their account, not at their table). */
  tableOfSession: Map<string, string>;
  groups: KitchenGroup[];
  readyPickups: OrderView[];
  pickupQueue: OrderView[];
  deliveryQueue: OrderView[];
  onTheWay: OrderView[];
  kitchenTarget: number;
  /** Channels the restaurant uses (for the orders card). */
  channels: OrderChannel[];
  /** Tabs of the queue: the kitchen always; pickup and deliveries while enabled or with orders still open. */
  tabs: QueueTab[];
  /** The order the tracking strip follows when nothing is selected. */
  featured: OrderView | null;
}

/** Everything the live view shows, from the plan, the active orders and the open table accounts. */
export function liveModel(input: {
  view: FloorPlanView | null;
  restaurant: { pickupEnabled: boolean; deliveryEnabled: boolean; kitchenTargetMinutes: number };
  orders: readonly OrderView[];
  sessions: readonly TableSessionView[];
  now: number;
}): LiveModel {
  const { restaurant } = input;
  const layout = liveLayout(input.view, restaurant);
  const orders = [...input.orders];
  const bySession = sessionsByTable(input.sessions);
  const tableStates = new Map(layout.tables.map((table) => [table.id, tableStatus(bySession.get(table.id))]));
  const tableOfSession = new Map([...bySession.values()].map((session) => [session.id, session.tableId]));
  const hasPickup = restaurant.pickupEnabled || orders.some((o) => o.channel === "pickup");
  const hasDelivery = restaurant.deliveryEnabled || orders.some((o) => o.channel === "delivery");
  const channels: OrderChannel[] = [
    ...(layout.dining ? (["dine_in"] as const) : []),
    ...(restaurant.pickupEnabled ? (["pickup"] as const) : []),
    ...(restaurant.deliveryEnabled ? (["delivery"] as const) : []),
  ];
  return {
    layout,
    orders,
    sessionsByTable: bySession,
    tableStates,
    tableOfSession,
    groups: kitchenGroups(orders, input.now, restaurant.kitchenTargetMinutes),
    readyPickups: readyPickups(orders),
    pickupQueue: pickupQueue(orders),
    deliveryQueue: deliveryQueue(orders),
    onTheWay: onTheWay(orders),
    kitchenTarget: restaurant.kitchenTargetMinutes,
    channels,
    tabs: ["kitchen", ...(hasPickup ? (["pickup"] as const) : []), ...(hasDelivery ? (["delivery"] as const) : [])],
    featured: featuredOrder(orders, hasDelivery),
  };
}
