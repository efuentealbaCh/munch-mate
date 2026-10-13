import type { GeoPoint } from "./geo";
import type { OrderChannel, OrderStatus } from "./orders";

/** Customer-side data of an account (any account can order; there is no separate customer sign-up). */
export const CUSTOMER_LIMITS = {
  addressesMax: 10,
  addressLabelMax: 30,
  ordersPageSize: 20,
} as const;

/** A delivery address saved by a customer. The zone is not stored: it depends on each restaurant. */
export interface SavedAddressView {
  id: string;
  /** "Casa", "Trabajo"… */
  label: string;
  address: string;
  unit: string;
  reference: string;
  location: GeoPoint | null;
  createdAt: string;
}

export interface SavedAddressInput {
  label: string;
  address: string;
  unit?: string;
  reference?: string;
  location?: GeoPoint | null;
}

/** `PATCH /api/me`: what a customer can change about themselves. */
export interface ProfileInput {
  name?: string;
  /** Any common format; stored normalized. "" clears it. */
  phone?: string;
}

/** One order in the customer's history ("Mis pedidos"). */
export interface CustomerOrderSummary {
  /** Opens the tracking page: `/pedido#t=<trackingToken>`. */
  trackingToken: string;
  restaurant: { name: string; slug: string };
  number: number;
  ticketNumber: number;
  channel: OrderChannel;
  status: OrderStatus;
  total: number;
  currency: string;
  /** Units in the order. */
  itemCount: number;
  createdAt: string;
}

export interface CustomerOrdersPage {
  items: CustomerOrderSummary[];
  /** Pass as `?before=` for the next (older) page; null when there are no more. */
  nextBefore: string | null;
}

// ── Web push ────────────────────────────────────────────────────────────────

/** `GET /api/public/push-config`. publicKey is null when push is not configured on this server. */
export interface PushConfig {
  publicKey: string | null;
}

/** A browser's PushSubscription as JSON (`subscription.toJSON()`). */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** What a notification shows; `url` opens on click (same origin). */
export interface PushNotification {
  title: string;
  body: string;
  url: string;
  /** Same tag = replaces the previous notification instead of piling up. */
  tag: string;
}
