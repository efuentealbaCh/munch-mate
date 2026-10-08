import {
  FINAL_ORDER_STATUSES,
  ORDER_CHANNEL_LABELS,
  type OrderChannel,
  type OrderStatus,
  type OrderView,
  type RestaurantRole,
} from "@app/types";

/** Staff order board: columns, merging live events with REST data, and the day summary. */

/** Roles that work the floor: see the board, open/close the restaurant (same list as the api). */
export const FLOOR_ROLES: readonly RestaurantRole[] = ["owner", "cashier", "kitchen"];

/** Roles that register payments (the api allows owner and cashier only). */
export const PAYMENT_ROLES: readonly RestaurantRole[] = ["owner", "cashier"];

export function canWorkOrders(roles: readonly RestaurantRole[]): boolean {
  return roles.some((role) => FLOOR_ROLES.includes(role));
}

export function canRegisterPayment(roles: readonly RestaurantRole[]): boolean {
  return roles.some((role) => PAYMENT_ROLES.includes(role));
}

export const BOARD_COLUMNS = [
  { status: "pending", title: "Pendientes" },
  { status: "accepted", title: "Aceptados" },
  { status: "preparing", title: "En preparación" },
  { status: "ready", title: "Listos" },
] as const satisfies ReadonlyArray<{ status: OrderStatus; title: string }>;

export type BoardStatus = (typeof BOARD_COLUMNS)[number]["status"];

/** Button text for moving an order to each status (the status label itself reads wrong on a button). */
export const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  accepted: "Aceptar",
  preparing: "Empezar",
  ready: "Listo",
  served: "Servido",
  picked_up: "Entregar",
  rejected: "Rechazar",
  cancelled: "Cancelar",
};

/** Quick reasons offered when rejecting (the customer sees the reason). */
export const QUICK_REJECT_REASONS = ["Se acabó un ingrediente", "Cocina saturada", "Cerramos"] as const;

export function isFinalStatus(status: OrderStatus): boolean {
  return FINAL_ORDER_STATUSES.includes(status);
}

/** Rejected or cancelled: final, but not a sale. */
export function isDroppedStatus(status: OrderStatus): boolean {
  return status === "rejected" || status === "cancelled";
}

// ── Channels ────────────────────────────────────────────────────────────────

/** Where the order goes, as the staff read it on a card: "Mesa 4" or "Para retirar". */
export function destinationLabel(order: Pick<OrderView, "channel" | "tableLabel">): string {
  if (order.channel === "dine_in") return order.tableLabel ?? "Sin mesa";
  return ORDER_CHANNEL_LABELS[order.channel];
}

export type ChannelFilter = "all" | Extract<OrderChannel, "dine_in" | "pickup">;

export const CHANNEL_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "dine_in", label: "Mesa" },
  { value: "pickup", label: "Retiro" },
] as const satisfies ReadonlyArray<{ value: ChannelFilter; label: string }>;

export function filterByChannel(orders: readonly OrderView[], filter: ChannelFilter): OrderView[] {
  return filter === "all" ? [...orders] : orders.filter((order) => order.channel === filter);
}

/**
 * Handing over an unpaid order is allowed (the customer may pay at the counter afterwards), but the staff
 * must see a warning first and get the chance to register the payment.
 */
export function needsPaymentWarning(order: Pick<OrderView, "paymentStatus">, to: OrderStatus): boolean {
  return to === "picked_up" && order.paymentStatus === "unpaid";
}

/**
 * The restaurant promised a time and it already passed while the order is not ready yet (shown in red).
 * @param now Current time in ms (0 = unknown → never late).
 */
export function isPastReadyTime(order: Pick<OrderView, "status" | "estimatedReadyAt">, now: number): boolean {
  if (!now || !order.estimatedReadyAt) return false;
  if (order.status !== "accepted" && order.status !== "preparing") return false;
  const eta = new Date(order.estimatedReadyAt).getTime();
  return !Number.isNaN(eta) && now > eta;
}

const byCreatedAsc = (a: OrderView, b: OrderView) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number;

/**
 * Splits active orders into the board columns, oldest first in each (first come, first served).
 * Orders in other statuses are left out.
 */
export function groupByColumn(orders: readonly OrderView[]): Record<BoardStatus, OrderView[]> {
  const columns: Record<BoardStatus, OrderView[]> = { pending: [], accepted: [], preparing: [], ready: [] };
  for (const order of orders) {
    if (order.status in columns) columns[order.status as BoardStatus].push(order);
  }
  for (const list of Object.values(columns)) list.sort(byCreatedAsc);
  return columns;
}

/**
 * Rough version of an order, to tell which of two copies is newer: events and REST responses can arrive
 * in any order (a list fetched before a change may land after its event). Every status change appends to
 * the history; payment only goes unpaid → paid.
 */
function revision(order: OrderView): number {
  return order.statusHistory.length * 2 + (order.paymentStatus === "paid" ? 1 : 0);
}

/** @returns The newer of two copies of the same order (`incoming` on ties: it is the latest received). */
export function newerOrder(current: OrderView | undefined, incoming: OrderView): OrderView {
  return current && revision(current) > revision(incoming) ? current : incoming;
}

/**
 * Applies one order (event or mutation response) to a list. Keeps the newer copy, and with `activeOnly`
 * drops orders that reached a final status (they leave the board).
 */
export function upsertOrder(list: readonly OrderView[], incoming: OrderView, activeOnly: boolean): OrderView[] {
  const current = list.find((order) => order.id === incoming.id);
  const next = newerOrder(current, incoming);
  const rest = list.filter((order) => order.id !== incoming.id);
  if (activeOnly && isFinalStatus(next.status)) return rest;
  return [...rest, next];
}

/**
 * Replaces the list with a fresh REST response, keeping any copy received meanwhile that is newer than
 * the fetched one (the fetch may have started before an event arrived).
 * @param receivedDuringFetch Ids that arrived by event while the request was in flight: kept even when the
 *   response does not include them (an order created after the server built the response).
 */
export function mergeFetched(
  current: readonly OrderView[],
  fetched: readonly OrderView[],
  activeOnly: boolean,
  receivedDuringFetch: ReadonlySet<string> = new Set(),
): OrderView[] {
  const known = new Map(current.map((order) => [order.id, order]));
  const fetchedIds = new Set(fetched.map((order) => order.id));
  const merged = [
    ...fetched.map((order) => newerOrder(known.get(order.id), order)),
    ...current.filter((order) => receivedDuringFetch.has(order.id) && !fetchedIds.has(order.id)),
  ];
  return activeOnly ? merged.filter((order) => !isFinalStatus(order.status)) : merged;
}

export function pendingCount(orders: readonly OrderView[]): number {
  return orders.filter((order) => order.status === "pending").length;
}

/** Whole minutes since `iso` (never negative, so a slightly fast client clock shows 0). */
export function minutesSince(iso: string, now: number): number {
  const created = new Date(iso).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((now - created) / 60_000));
}

/** "recién", "hace 1 min", "hace 12 min", "hace 1 h 05 min". */
export function elapsedLabel(minutes: number): string {
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** "(2) Pedidos" while orders wait to be accepted, "Pedidos" otherwise. */
export function boardTitle(pending: number, base = "Pedidos"): string {
  return pending > 0 ? `(${pending}) ${base}` : base;
}

export interface DayTotals {
  /** Orders that count as sales (rejected and cancelled excluded). */
  count: number;
  /** Σ total of those orders. */
  total: number;
  /** Σ total of the paid ones. */
  paid: number;
  /** Rejected + cancelled, shown apart. */
  dropped: number;
}

/**
 * Simple day summary for the "Hoy" tab. All orders must share one currency (a restaurant has one).
 */
export function dayTotals(orders: readonly OrderView[]): DayTotals {
  const totals: DayTotals = { count: 0, total: 0, paid: 0, dropped: 0 };
  for (const order of orders) {
    if (isDroppedStatus(order.status)) {
      totals.dropped += 1;
      continue;
    }
    totals.count += 1;
    totals.total += order.total;
    if (order.paymentStatus === "paid") totals.paid += order.total;
  }
  return totals;
}

/** Newest first, for the "Hoy" list (the api already sends it that way; events are inserted in place). */
export function sortNewestFirst(orders: readonly OrderView[]): OrderView[] {
  return [...orders].sort((a, b) => -byCreatedAsc(a, b));
}
