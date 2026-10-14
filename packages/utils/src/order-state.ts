import type { OrderChannel, OrderStatus, RestaurantRole } from "@app/types";

/** Who triggers a transition: a staff member (with roles) or the customer holding the order's access token. */
export type OrderActor = { kind: "staff"; roles: readonly RestaurantRole[] } | { kind: "customer" };

interface Transition {
  to: OrderStatus;
  /** Staff roles allowed; the customer may only do what `customer: true` marks. */
  roles: readonly RestaurantRole[];
  customer?: boolean;
  /** A reason is mandatory (shown to the customer). */
  requiresReason?: boolean;
  /** The staff must say when the order will be ready (pickup acceptance). */
  requiresReadyTime?: boolean;
}

const FLOOR: readonly RestaurantRole[] = ["owner", "cashier", "kitchen"];
/** Table orders: the waiters (phase 8) work them too; pickup and delivery stay with the floor roles. */
const TABLE: readonly RestaurantRole[] = [...FLOOR, "waiter"];
/** Taking the order out and handing it over. A rider may only act on deliveries assigned to them (api check). */
const DISPATCH: readonly RestaurantRole[] = [...FLOOR, "rider"];

/** Staff roles that work the orders of each channel through the kitchen (riders only take deliveries out). */
export const ORDER_WORK_ROLES: Record<OrderChannel, readonly RestaurantRole[]> = {
  dine_in: TABLE,
  pickup: FLOOR,
  delivery: FLOOR,
};

/** Statuses in which the staff may still change an order's items: before the kitchen starts preparing it. */
export const EDITABLE_ORDER_STATUSES: readonly OrderStatus[] = ["pending", "accepted"];

/**
 * Allowed transitions per channel. Shared by the api (enforcement) and the web (which buttons to show).
 *
 *   pending ──► accepted ──► preparing ──► ready ──► served            (dine_in)
 *                                                  ├──► picked_up         (pickup; accepting asks for a ready time)
 *                                                  └──► out_for_delivery ──► delivered  (delivery; asks for an ETA)
 *      │           │
 *      ├──► rejected (staff, with reason)
 *      └───────────┴──► cancelled (staff, with reason; the customer only while pending)
 */
const TRANSITIONS: Record<OrderChannel, Partial<Record<OrderStatus, Transition[]>>> = {
  dine_in: {
    pending: [
      { to: "accepted", roles: TABLE },
      { to: "rejected", roles: TABLE, requiresReason: true },
      { to: "cancelled", roles: TABLE, customer: true, requiresReason: true },
    ],
    accepted: [
      { to: "preparing", roles: TABLE },
      { to: "cancelled", roles: TABLE, requiresReason: true },
    ],
    preparing: [{ to: "ready", roles: TABLE }],
    ready: [{ to: "served", roles: TABLE }],
  },
  pickup: {
    pending: [
      { to: "accepted", roles: FLOOR, requiresReadyTime: true },
      { to: "rejected", roles: FLOOR, requiresReason: true },
      { to: "cancelled", roles: FLOOR, customer: true, requiresReason: true },
    ],
    accepted: [
      { to: "preparing", roles: FLOOR },
      { to: "cancelled", roles: FLOOR, requiresReason: true },
    ],
    preparing: [{ to: "ready", roles: FLOOR }],
    // Handing over an unpaid order is allowed: the web warns and offers to register the payment first.
    ready: [{ to: "picked_up", roles: FLOOR }],
  },
  delivery: {
    pending: [
      { to: "accepted", roles: FLOOR, requiresReadyTime: true },
      { to: "rejected", roles: FLOOR, requiresReason: true },
      { to: "cancelled", roles: FLOOR, customer: true, requiresReason: true },
    ],
    accepted: [
      { to: "preparing", roles: FLOOR },
      { to: "cancelled", roles: FLOOR, requiresReason: true },
    ],
    preparing: [{ to: "ready", roles: FLOOR }],
    ready: [{ to: "out_for_delivery", roles: DISPATCH }],
    out_for_delivery: [{ to: "delivered", roles: DISPATCH }],
  },
};

export type TransitionCheck =
  | { ok: true; requiresReason: boolean; requiresReadyTime: boolean }
  | { ok: false; reason: "invalid_transition" | "forbidden" };

/**
 * Validates a status change.
 * @returns `invalid_transition` when the state machine does not allow it at all (→ 409), `forbidden` when it
 *   exists but this actor may not perform it (→ 403).
 */
export function checkTransition(
  channel: OrderChannel,
  from: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
): TransitionCheck {
  const transition = TRANSITIONS[channel][from]?.find((t) => t.to === to);
  if (!transition) return { ok: false, reason: "invalid_transition" };

  const allowed =
    actor.kind === "customer"
      ? transition.customer === true
      : transition.roles.some((role) => actor.roles.includes(role));
  return allowed
    ? {
        ok: true,
        requiresReason: transition.requiresReason === true,
        requiresReadyTime: transition.requiresReadyTime === true,
      }
    : { ok: false, reason: "forbidden" };
}

/** Statuses the actor can move the order to next, in display order (primary action first). */
export function nextStatuses(channel: OrderChannel, from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return (TRANSITIONS[channel][from] ?? [])
    .filter((t) => checkTransition(channel, from, t.to, actor).ok)
    .map((t) => t.to);
}

/** Whether an order's items may still be edited (nothing has been prepared yet). */
export function isOrderEditable(status: OrderStatus): boolean {
  return EDITABLE_ORDER_STATUSES.includes(status);
}

/**
 * Whether a staff member may edit the items of an order of this channel: the same roles that move it through
 * the kitchen (waiters only table orders; riders never).
 */
export function canEditOrder(channel: OrderChannel, roles: readonly RestaurantRole[]): boolean {
  return ORDER_WORK_ROLES[channel].some((role) => roles.includes(role));
}
