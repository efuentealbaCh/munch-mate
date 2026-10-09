import {
  FINAL_ORDER_STATUSES,
  ORDER_CHANNEL_LABELS,
  type OrderChannel,
  type OrderStatus,
  type OrderView,
  type RestaurantRole,
} from "@app/types";
import { checkTransition } from "@app/utils";

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

/** Roles that assign deliveries to riders (same as payments: owner and cashier). */
export const RIDER_ASSIGN_ROLES: readonly RestaurantRole[] = ["owner", "cashier"];

export function canAssignRider(roles: readonly RestaurantRole[]): boolean {
  return roles.some((role) => RIDER_ASSIGN_ROLES.includes(role));
}

/** Members with the rider role get the "Repartos" screen (their own deliveries). */
export function isRider(roles: readonly RestaurantRole[]): boolean {
  return roles.includes("rider");
}

/** Riders without any floor role cannot see the board: their home is the "Repartos" screen. */
export function isRiderOnly(roles: readonly RestaurantRole[]): boolean {
  return isRider(roles) && !canWorkOrders(roles);
}

/** Where a member lands when opening a restaurant: riders only → their deliveries; everyone else → summary. */
export function restaurantHomeHref(restaurant: { id: string; myRoles: readonly RestaurantRole[] }): string {
  const base = `/admin/${restaurant.id}`;
  return isRiderOnly(restaurant.myRoles) ? `${base}/repartos` : base;
}

export const BOARD_COLUMNS = [
  { status: "pending", title: "Pendientes" },
  { status: "accepted", title: "Aceptados" },
  { status: "preparing", title: "En preparación" },
  { status: "ready", title: "Listos" },
  { status: "out_for_delivery", title: "En reparto" },
] as const satisfies ReadonlyArray<{ status: OrderStatus; title: string }>;

export type BoardStatus = (typeof BOARD_COLUMNS)[number]["status"];

/** Board columns to render: "En reparto" only matters when delivery is on (or such orders still exist). */
export function boardColumns(includeDelivery: boolean): ReadonlyArray<(typeof BOARD_COLUMNS)[number]> {
  return includeDelivery ? BOARD_COLUMNS : BOARD_COLUMNS.filter((column) => column.status !== "out_for_delivery");
}

/** Button text for moving an order to each status (the status label itself reads wrong on a button). */
export const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  accepted: "Aceptar",
  preparing: "Empezar",
  ready: "Listo",
  served: "Servido",
  picked_up: "Entregar",
  out_for_delivery: "En reparto",
  delivered: "Entregado",
  rejected: "Rechazar",
  cancelled: "Cancelar",
};

/** Quick reasons offered when rejecting (the customer sees the reason). */
export const QUICK_REJECT_REASONS = ["Se acabó un ingrediente", "Cocina saturada", "Cerramos"] as const;

/** Quick reasons offered when cancelling an order already in the board (the customer sees the reason). */
export const QUICK_CANCEL_REASONS = ["El cliente lo pidió", "Se acabó un ingrediente", "No pudimos contactar al cliente"] as const;

/** Statuses whose transition asks the staff for a reason the customer will read. */
export type ReasonStatus = Extract<OrderStatus, "rejected" | "cancelled">;

/** Texts of the reason dialog, per status. */
export const REASON_DIALOG_TEXTS: Record<
  ReasonStatus,
  { title: string; description: string; submit: string; done: string; quickReasons: readonly string[] }
> = {
  rejected: {
    title: "Rechazar pedido",
    description: "El cliente verá el motivo en su teléfono.",
    submit: "Rechazar pedido",
    done: "rechazado",
    quickReasons: QUICK_REJECT_REASONS,
  },
  cancelled: {
    title: "Cancelar pedido",
    description: "El cliente verá el motivo en su teléfono. No se puede deshacer.",
    submit: "Cancelar pedido",
    done: "cancelado",
    quickReasons: QUICK_CANCEL_REASONS,
  },
};

/** What the board does when the staff tap an action button. */
export type ActionStep = "reason" | "ready_time" | "payment_warning" | "direct";

/**
 * Decides the step before changing an order's status, from the shared state machine (`checkTransition`)
 * rather than from the status by hand: reason dialog (reject, cancel), ready-time dialog (accepting pickup
 * or delivery), unpaid hand-over warning, or straight to the api. A transition the actor may not make goes
 * "direct" so the api answers with its own error.
 */
export function actionStep(
  order: Pick<OrderView, "channel" | "status" | "paymentStatus">,
  to: OrderStatus,
  roles: readonly RestaurantRole[],
): ActionStep {
  const check = checkTransition(order.channel, order.status, to, { kind: "staff", roles });
  if (check.ok && check.requiresReason) return "reason";
  if (check.ok && check.requiresReadyTime) return "ready_time";
  if (needsPaymentWarning(order, to)) return "payment_warning";
  return "direct";
}

export function isFinalStatus(status: OrderStatus): boolean {
  return FINAL_ORDER_STATUSES.includes(status);
}

/** Rejected or cancelled: final, but not a sale. */
export function isDroppedStatus(status: OrderStatus): boolean {
  return status === "rejected" || status === "cancelled";
}

// ── Channels ────────────────────────────────────────────────────────────────

/** Where the order goes, as the staff read it on a card: "Mesa 4", "Para retirar" or "Delivery · Ñuñoa". */
export function destinationLabel(order: Pick<OrderView, "channel" | "tableLabel"> & { delivery?: OrderView["delivery"] }): string {
  if (order.channel === "dine_in") return order.tableLabel ?? "Sin mesa";
  if (order.channel === "delivery" && order.delivery?.zoneName) return `${ORDER_CHANNEL_LABELS.delivery} · ${order.delivery.zoneName}`;
  return ORDER_CHANNEL_LABELS[order.channel];
}

export type ChannelFilter = "all" | OrderChannel;

export const CHANNEL_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "dine_in", label: "Mesa" },
  { value: "pickup", label: "Retiro" },
  { value: "delivery", label: "Delivery" },
] as const satisfies ReadonlyArray<{ value: ChannelFilter; label: string }>;

/**
 * Filters worth offering: "Todos", "Mesa" (tables always exist) and each other channel that is turned on or
 * still has orders in the lists. With only tables there is nothing to filter (empty result).
 */
export function availableChannelFilters(
  restaurant: { pickupEnabled: boolean; deliveryEnabled: boolean },
  orders: readonly Pick<OrderView, "channel">[],
): Array<(typeof CHANNEL_FILTERS)[number]> {
  const present = new Set(orders.map((order) => order.channel));
  const shown = CHANNEL_FILTERS.filter(
    (filter) =>
      filter.value === "all" ||
      filter.value === "dine_in" ||
      (filter.value === "pickup" && (restaurant.pickupEnabled || present.has("pickup"))) ||
      (filter.value === "delivery" && (restaurant.deliveryEnabled || present.has("delivery"))),
  );
  return shown.length > 2 ? shown : [];
}

export function filterByChannel(orders: readonly OrderView[], filter: ChannelFilter): OrderView[] {
  return filter === "all" ? [...orders] : orders.filter((order) => order.channel === filter);
}

/**
 * Handing over an unpaid order is allowed (the customer may pay at the counter afterwards), but the staff
 * must see a warning first and get the chance to register the payment.
 */
export function needsPaymentWarning(order: Pick<OrderView, "paymentStatus">, to: OrderStatus): boolean {
  return (to === "picked_up" || to === "delivered") && order.paymentStatus === "unpaid";
}

/** The status that hands an order over to the customer in its channel (null for dine-in, which is "Servido"). */
export function handOverStatus(channel: OrderChannel): Extract<OrderStatus, "picked_up" | "delivered"> | null {
  if (channel === "pickup") return "picked_up";
  if (channel === "delivery") return "delivered";
  return null;
}

/**
 * The restaurant promised a time and it already passed while the order is not ready yet (shown in red).
 * @param now Current time in ms (0 = unknown → never late).
 */
export function isPastReadyTime(
  order: Pick<OrderView, "status" | "estimatedReadyAt"> & { channel?: OrderChannel },
  now: number,
): boolean {
  if (!now || !order.estimatedReadyAt) return false;
  // Delivery promises an arrival time: it is still late while ready or on its way.
  const waiting: readonly OrderStatus[] =
    order.channel === "delivery" ? ["accepted", "preparing", "ready", "out_for_delivery"] : ["accepted", "preparing"];
  if (!waiting.includes(order.status)) return false;
  const eta = new Date(order.estimatedReadyAt).getTime();
  return !Number.isNaN(eta) && now > eta;
}

const byCreatedAsc = (a: OrderView, b: OrderView) => a.createdAt.localeCompare(b.createdAt) || a.number - b.number;

/**
 * Splits active orders into the board columns, oldest first in each (first come, first served).
 * Orders in other statuses are left out.
 */
export function groupByColumn(orders: readonly OrderView[]): Record<BoardStatus, OrderView[]> {
  const columns: Record<BoardStatus, OrderView[]> = { pending: [], accepted: [], preparing: [], ready: [], out_for_delivery: [] };
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

/**
 * @returns The newer of two copies of the same order: by `updatedAt` (every write bumps it, including rider
 *   assignments), then by revision; `incoming` on ties (it is the latest received).
 */
export function newerOrder(current: OrderView | undefined, incoming: OrderView): OrderView {
  if (!current) return incoming;
  const byTime = Date.parse(current.updatedAt) - Date.parse(incoming.updatedAt);
  if (byTime !== 0 && !Number.isNaN(byTime)) return byTime > 0 ? current : incoming;
  return revision(current) > revision(incoming) ? current : incoming;
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

/**
 * Applies an order event to a rider's own list. Riders receive every order of the restaurant room, so only
 * deliveries assigned to them and still in progress stay (an unassigned or reassigned one leaves).
 */
export function upsertRiderDelivery(list: readonly OrderView[], incoming: OrderView, riderId: string): OrderView[] {
  const mine = incoming.channel === "delivery" && incoming.rider?.id === riderId;
  if (!mine) return list.filter((order) => order.id !== incoming.id);
  return upsertOrder(list, incoming, true);
}

const RIDER_STATUS_ORDER: readonly OrderStatus[] = ["out_for_delivery", "ready", "preparing", "accepted", "pending"];

/** A rider's list: what is on the road first, then what is ready to go out, then the rest; oldest first in each. */
export function sortRiderDeliveries(orders: readonly OrderView[]): OrderView[] {
  const rank = (order: OrderView) => {
    const index = RIDER_STATUS_ORDER.indexOf(order.status);
    return index === -1 ? RIDER_STATUS_ORDER.length : index;
  };
  return [...orders].sort((a, b) => rank(a) - rank(b) || byCreatedAsc(a, b));
}

/** Rider-only actor: on the "Repartos" screen even a cashier-rider only takes orders out and delivers them. */
export const RIDER_ACTOR = { kind: "staff", roles: ["rider"] } as const satisfies { kind: "staff"; roles: readonly RestaurantRole[] };

/** Button text on the rider's screen (different from the board's: it is the rider's own action). */
export const RIDER_ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  out_for_delivery: "Salir a repartir",
  delivered: "Entregado",
};

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
