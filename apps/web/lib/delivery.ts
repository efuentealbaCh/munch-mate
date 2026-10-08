import {
  type ExpectedPaymentView,
  type OrderDeliveryView,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type PublicDeliveryZone,
} from "@app/types";
import type { KeyValueStorage } from "./cart";
import { formatPrice } from "./money";

/**
 * Delivery helpers (phase 5): channel choice at checkout, zone defaults, fee/total/change estimates, address
 * and payment wording, and the contact data remembered on the device.
 * Amounts here are ESTIMATES for display: the api prices the order and checks the zone minimum and the cash
 * amount; its answer is the truth.
 */

// ── Channel choice ──────────────────────────────────────────────────────────

/** Channels a customer can order through from the public menu (not the table QR). */
export type OnlineChannel = "pickup" | "delivery";

export const ONLINE_CHANNEL_LABELS: Record<OnlineChannel, string> = {
  pickup: "Retiro en local",
  delivery: "Delivery",
};

/** Channels the owner turned on, pickup first. Empty = the public menu is read-only. */
export function onlineChannels(restaurant: { pickupEnabled: boolean; deliveryEnabled: boolean }): OnlineChannel[] {
  const channels: OnlineChannel[] = [];
  if (restaurant.pickupEnabled) channels.push("pickup");
  if (restaurant.deliveryEnabled) channels.push("delivery");
  return channels;
}

/**
 * Keeps the customer's choice while it is still offered; otherwise falls back to the first one offered
 * (e.g. the owner turned delivery off while the cart was open).
 * @returns The channel to use, or null when none is enabled.
 */
export function resolveChannel(current: OnlineChannel | null, available: readonly OnlineChannel[]): OnlineChannel | null {
  if (current && available.includes(current)) return current;
  return available[0] ?? null;
}

// ── Zones and totals ────────────────────────────────────────────────────────

/** Zone preselected at checkout: the restaurant's own ("zona del local"), else the first one. */
export function defaultZoneId(zones: readonly Pick<PublicDeliveryZone, "id" | "isHome">[]): string {
  return (zones.find((zone) => zone.isHome) ?? zones[0])?.id ?? "";
}

export interface DeliveryTotals {
  subtotal: number;
  fee: number;
  /** subtotal + fee. */
  total: number;
  /** How much is missing to reach the zone's minimum (compared WITHOUT the fee, like the api); 0 = reached. */
  missing: number;
}

/**
 * Estimated totals of a delivery cart for a zone. Without a zone the fee is 0 and there is no minimum.
 * @param subtotal Cart total (minor units).
 */
export function deliveryTotals(subtotal: number, zone: Pick<PublicDeliveryZone, "fee" | "minOrder"> | null | undefined): DeliveryTotals {
  const fee = zone?.fee ?? 0;
  return { subtotal, fee, total: subtotal + fee, missing: Math.max(0, (zone?.minOrder ?? 0) - subtotal) };
}

/**
 * Change the rider must bring when the customer pays cash with `cashAmount`.
 * @returns The change (0 when it is exact), or null when there is no amount or it does not cover the total.
 */
export function cashChange(total: number, cashAmount: number | null | undefined): number | null {
  if (cashAmount === null || cashAmount === undefined || !Number.isSafeInteger(cashAmount)) return null;
  return cashAmount >= total ? cashAmount - total : null;
}

/** "Providencia · envío $1.990 · mínimo $8.000" (option text of the zone picker). */
export function zoneOptionLabel(zone: Pick<PublicDeliveryZone, "name" | "fee" | "minOrder">, currency: string): string {
  const parts = [zone.name, zone.fee > 0 ? `envío ${formatPrice(zone.fee, currency)}` : "envío gratis"];
  if (zone.minOrder > 0) parts.push(`mínimo ${formatPrice(zone.minOrder, currency)}`);
  return parts.join(" · ");
}

// ── Address and payment wording ─────────────────────────────────────────────

/** "Av. Italia 1234, Depto 402" (street and number plus the unit, if any). */
export function addressLine(delivery: Pick<OrderDeliveryView, "address" | "unit">): string {
  return delivery.unit ? `${delivery.address}, ${delivery.unit}` : delivery.address;
}

/**
 * Google Maps search for the address (no coordinates: zones are plain names). Opening it is up to the rider.
 */
export function mapsSearchUrl(delivery: Pick<OrderDeliveryView, "address" | "zoneName">): string {
  const query = [delivery.address, delivery.zoneName].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/**
 * How the customer said they will pay, for the staff and the tracking page:
 * "Efectivo · paga con $20.000 · vuelto $3.010", "Tarjeta (POS)".
 */
export function expectedPaymentLabel(payment: ExpectedPaymentView, currency: string): string {
  const parts = [PAYMENT_METHOD_LABELS[payment.method]];
  if (payment.method === "cash" && payment.cashAmount !== null) {
    parts.push(`paga con ${formatPrice(payment.cashAmount, currency)}`);
    if (payment.change !== null) parts.push(payment.change > 0 ? `vuelto ${formatPrice(payment.change, currency)}` : "monto exacto");
  }
  return parts.join(" · ");
}

/**
 * The same for the customer's tracking page: "Efectivo (pagas con $20.000, vuelto $3.010)", "Transferencia".
 */
export function customerPaymentLabel(payment: ExpectedPaymentView, currency: string): string {
  const label = PAYMENT_METHOD_LABELS[payment.method];
  if (payment.method !== "cash" || payment.cashAmount === null) return label;
  const change =
    payment.change === null ? "" : payment.change > 0 ? `, vuelto ${formatPrice(payment.change, currency)}` : ", monto exacto";
  return `${label} (pagas con ${formatPrice(payment.cashAmount, currency)}${change})`;
}

/** Payment methods with the one the customer announced first (the rider's most likely tap). */
export function methodsExpectedFirst(methods: readonly PaymentMethod[], expected: PaymentMethod | null | undefined): PaymentMethod[] {
  if (!expected || !methods.includes(expected)) return [...methods];
  return [expected, ...methods.filter((method) => method !== expected)];
}

// ── Contact remembered on this device (localStorage) ────────────────────────

/** What the checkout prefills on the next delivery order. Only a convenience: losing it is harmless. */
export interface SavedDeliveryContact {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  zoneId: string;
  address: string;
  unit: string;
  reference: string;
}

export const DELIVERY_CONTACT_KEY = "mm:delivery-contact";

const CONTACT_FIELDS = ["customerName", "customerPhone", "customerEmail", "zoneId", "address", "unit", "reference"] as const;

/** Storage errors and malformed data give null (the form then starts empty). */
export function loadDeliveryContact(storage: KeyValueStorage | undefined): SavedDeliveryContact | null {
  try {
    const raw = storage?.getItem(DELIVERY_CONTACT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (typeof data !== "object" || data === null) return null;
    const contact = {} as SavedDeliveryContact;
    for (const field of CONTACT_FIELDS) {
      const value = data[field];
      // Bounded, so a tampered entry cannot blow up the form.
      contact[field] = typeof value === "string" ? value.slice(0, 200) : "";
    }
    return contact;
  } catch {
    return null;
  }
}

export function saveDeliveryContact(storage: KeyValueStorage | undefined, contact: SavedDeliveryContact): void {
  try {
    const clean = Object.fromEntries(CONTACT_FIELDS.map((field) => [field, contact[field].trim()]));
    storage?.setItem(DELIVERY_CONTACT_KEY, JSON.stringify(clean));
  } catch {
    // Quota or disabled storage: the next order simply starts with an empty form.
  }
}
