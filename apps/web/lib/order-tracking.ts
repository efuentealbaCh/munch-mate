import type { OrderChannel, OrderStatus } from "@app/types";
import type { KeyValueStorage } from "./cart";

/**
 * Customer-side order tracking helpers: the tracking URL, the "mis pedidos" list kept on the device and
 * the status steps of the tracking page.
 */

// ── Tracking URL ────────────────────────────────────────────────────────────

/** Same bounds as the api's AccessTokenDto (base64url HMAC today: 43 chars). */
const ACCESS_TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * Tracking page of an order. The token goes in the URL fragment: browsers never send fragments to the
 * server, so it stays out of access logs and Referer headers.
 */
export function trackingHref(accessToken: string): string {
  return `/pedido#t=${encodeURIComponent(accessToken)}`;
}

/**
 * Reads the access token from `location.hash` ("#t=<token>").
 * @returns The token, or null when the fragment has none or it cannot be a valid token.
 */
export function parseTrackingHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("t")?.trim();
  return token && ACCESS_TOKEN.test(token) ? token : null;
}

// ── "Mis pedidos" (localStorage) ────────────────────────────────────────────

export interface MyOrder {
  accessToken: string;
  ticketNumber: number;
  restaurantName: string;
  createdAt: string;
  /** Table QR code the order came from, for the "Pedir algo más" link. */
  tableToken?: string;
}

export const MY_ORDERS_KEY = "mm:my-orders";
export const MY_ORDERS_MAX = 10;

function parseMyOrder(value: unknown): MyOrder | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.accessToken !== "string" || !ACCESS_TOKEN.test(o.accessToken)) return null;
  if (typeof o.ticketNumber !== "number" || typeof o.restaurantName !== "string" || typeof o.createdAt !== "string") {
    return null;
  }
  return {
    accessToken: o.accessToken,
    ticketNumber: o.ticketNumber,
    restaurantName: o.restaurantName,
    createdAt: o.createdAt,
    ...(typeof o.tableToken === "string" ? { tableToken: o.tableToken } : {}),
  };
}

/** Newest first. Storage errors and malformed data give an empty list. */
export function loadMyOrders(storage: KeyValueStorage | undefined): MyOrder[] {
  try {
    const raw = storage?.getItem(MY_ORDERS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.map(parseMyOrder).filter((order): order is MyOrder => order !== null).slice(0, MY_ORDERS_MAX);
  } catch {
    return [];
  }
}

/**
 * Adds (or moves to the top) an order and keeps the newest MY_ORDERS_MAX.
 * @returns The stored list (also when storage is unavailable, so the caller can show it anyway).
 */
export function rememberOrder(storage: KeyValueStorage | undefined, order: MyOrder): MyOrder[] {
  const list = [order, ...loadMyOrders(storage).filter((o) => o.accessToken !== order.accessToken)].slice(0, MY_ORDERS_MAX);
  try {
    storage?.setItem(MY_ORDERS_KEY, JSON.stringify(list));
  } catch {
    // Quota or disabled storage: the order still works through its link, it just will not be listed.
  }
  return list;
}

/** @returns The stored entry for a token (to recover its table link), or undefined. */
export function findMyOrder(storage: KeyValueStorage | undefined, accessToken: string): MyOrder | undefined {
  return loadMyOrders(storage).find((order) => order.accessToken === accessToken);
}

// ── Status steps ────────────────────────────────────────────────────────────

/** Happy path of a dine-in order, as shown in the step indicator. */
export const DINE_IN_STEPS: readonly OrderStatus[] = ["pending", "accepted", "preparing", "ready", "served"];

/** Happy path of a pickup order: ends when the customer picks it up. */
export const PICKUP_STEPS: readonly OrderStatus[] = ["pending", "accepted", "preparing", "ready", "picked_up"];

/** Steps shown to the customer for a channel (delivery arrives in phase 5; until then it uses pickup's). */
export function customerSteps(channel: OrderChannel): readonly OrderStatus[] {
  return channel === "dine_in" ? DINE_IN_STEPS : PICKUP_STEPS;
}

/**
 * Position of a status in its channel's steps.
 * @returns The index, or -1 for statuses outside the happy path (rejected, cancelled).
 */
export function stepIndex(status: OrderStatus, channel: OrderChannel = "dine_in"): number {
  return customerSteps(channel).indexOf(status);
}

/** Short explanation under the status, in the customer's words (dine-in). */
export const CUSTOMER_STATUS_HINTS: Partial<Record<OrderStatus, string>> = {
  pending: "El local está revisando tu pedido.",
  accepted: "¡Tu pedido fue aceptado! Pronto empiezan a prepararlo.",
  preparing: "Tu pedido se está preparando.",
  ready: "Tu pedido está listo. Ya te lo llevan a la mesa.",
  served: "¡Buen provecho!",
  rejected: "El local no pudo tomar tu pedido.",
  cancelled: "Este pedido fue cancelado.",
};

/** Pickup wording: nobody brings it to a table, the customer comes for it. */
const PICKUP_STATUS_HINTS: Partial<Record<OrderStatus, string>> = {
  ...CUSTOMER_STATUS_HINTS,
  pending: "El local está revisando tu pedido. Te avisamos aquí cuando lo acepte.",
  ready: "¡Tu pedido está listo! Ya puedes retirarlo.",
  picked_up: "¡Gracias! Ya retiraste tu pedido.",
};

/** Hint under the status for the order's channel. */
export function customerStatusHint(status: OrderStatus, channel: OrderChannel): string | undefined {
  return (channel === "dine_in" ? CUSTOMER_STATUS_HINTS : PICKUP_STATUS_HINTS)[status];
}

/**
 * Whether the "ready at about HH:MM" estimate is still worth showing: once the order is ready (or over) the
 * customer needs "come for it" instead of a time.
 */
export function showsReadyEstimate(order: { status: OrderStatus; estimatedReadyAt: string | null }): boolean {
  return order.estimatedReadyAt !== null && (order.status === "accepted" || order.status === "preparing");
}
