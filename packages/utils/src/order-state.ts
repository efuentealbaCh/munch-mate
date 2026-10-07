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
}

const FLOOR: readonly RestaurantRole[] = ["owner", "cashier", "kitchen"];

/**
 * Allowed transitions per channel. Shared by the api (enforcement) and the web (which buttons to show).
 *
 *   pending ──► accepted ──► preparing ──► ready ──► served            (dine_in)
 *      │           │
 *      ├──► rejected (staff, with reason)
 *      └───────────┴──► cancelled (staff; the customer only while pending)
 */
const TRANSITIONS: Record<OrderChannel, Partial<Record<OrderStatus, Transition[]>>> = {
  dine_in: {
    pending: [
      { to: "accepted", roles: FLOOR },
      { to: "rejected", roles: FLOOR, requiresReason: true },
      { to: "cancelled", roles: FLOOR, customer: true },
    ],
    accepted: [
      { to: "preparing", roles: FLOOR },
      { to: "cancelled", roles: FLOOR },
    ],
    preparing: [{ to: "ready", roles: FLOOR }],
    ready: [{ to: "served", roles: FLOOR }],
  },
  // Phases 4 and 5.
  pickup: {},
  delivery: {},
};

export type TransitionCheck =
  | { ok: true; requiresReason: boolean }
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
  return allowed ? { ok: true, requiresReason: transition.requiresReason === true } : { ok: false, reason: "forbidden" };
}

/** Statuses the actor can move the order to next, in display order (primary action first). */
export function nextStatuses(channel: OrderChannel, from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return (TRANSITIONS[channel][from] ?? [])
    .filter((t) => checkTransition(channel, from, t.to, actor).ok)
    .map((t) => t.to);
}
