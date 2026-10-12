import {
  CUSTOMER_LIMITS,
  type CustomerOrderSummary,
  type CustomerOrdersPage,
  FINAL_ORDER_STATUSES,
  type GeoPoint,
  ORDER_LIMITS,
  type OrderStatus,
  type SavedAddressInput,
  type SavedAddressView,
  type UserProfile,
} from "@app/types";
import { formatPhone } from "@app/utils";
import type { KeyValueStorage } from "./cart";

/**
 * Customer accounts on the web (phase 6): the "this browser has a session" hint for the public pages, the
 * checkout prefill from the profile and the saved addresses, and the order history pages.
 */

// ── Session hint ────────────────────────────────────────────────────────────

/**
 * The public pages (/r, /m, /pedido) must not ask /api/auth/me on every visit: for a guest that is one 401
 * plus two refresh 401s. The session cookies are httpOnly, so the AuthProvider leaves this hint whenever it
 * sees a session (and removes it when there is none); the public pages only ask when it is there.
 */
export const SESSION_HINT_KEY = "mm:session";

export function hasSessionHint(storage: KeyValueStorage | undefined): boolean {
  try {
    return storage?.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSessionHint(storage: KeyValueStorage | undefined, on: boolean): void {
  try {
    if (on) storage?.setItem(SESSION_HINT_KEY, "1");
    else storage?.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage disabled: the public pages simply treat the visitor as a guest.
  }
}

// ── Checkout prefill ────────────────────────────────────────────────────────

/**
 * Fills the contact fields from the account, but only the empty ones: what the customer already typed, or
 * what this device remembered from the last order, wins. The phone is shown formatted ("+569 12345678").
 * Works for the table checkout too (no phone field there).
 */
export function prefillContact<T extends { customerName: string; customerPhone?: string }>(
  current: T,
  profile: Pick<UserProfile, "name" | "phone">,
): T {
  const next = { ...current };
  const name = profile.name.trim().slice(0, ORDER_LIMITS.customerNameMax);
  if (current.customerName.trim() === "" && name) next.customerName = name;
  if (current.customerPhone !== undefined && current.customerPhone.trim() === "" && profile.phone) {
    next.customerPhone = formatPhone(profile.phone);
  }
  return next;
}

/** Address fields of the delivery checkout. */
export interface AddressFields {
  address: string;
  unit: string;
  reference: string;
}

/** A saved address as the checkout fields (and its pin, which also chooses the zone). */
export function savedAddressToCheckout(saved: SavedAddressView): AddressFields & { location: GeoPoint | null } {
  return { address: saved.address, unit: saved.unit, reference: saved.reference, location: saved.location };
}

/** "Av. Italia 1234, Depto 402" for the selector and the account page. */
export function savedAddressLine(saved: Pick<SavedAddressView, "address" | "unit">): string {
  return saved.unit ? `${saved.address}, ${saved.unit}` : saved.address;
}

/** Case and spacing do not make a different address. */
function sameText(a: string, b: string): boolean {
  const clean = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("es-CL");
  return clean(a) === clean(b);
}

/** The saved address the checkout currently shows (same street and unit), if any. */
export function findSavedAddress(
  addresses: readonly SavedAddressView[],
  fields: Pick<AddressFields, "address" | "unit">,
): SavedAddressView | undefined {
  return addresses.find((saved) => sameText(saved.address, fields.address) && sameText(saved.unit, fields.unit));
}

/** "Guardar esta dirección" makes sense: a real address, not saved yet, and room left (10 max). */
export function canOfferSaveAddress(addresses: readonly SavedAddressView[], fields: Pick<AddressFields, "address" | "unit">): boolean {
  return addresses.length < CUSTOMER_LIMITS.addressesMax && fields.address.trim().length >= 3 && !findSavedAddress(addresses, fields);
}

const LABEL_SUGGESTIONS = ["Casa", "Trabajo", "Otra"];

/** A label not used yet (labels are unique per account: 409 ADDRESS_LABEL_TAKEN). */
export function suggestAddressLabel(addresses: readonly Pick<SavedAddressView, "label">[]): string {
  const taken = new Set(addresses.map((saved) => saved.label.trim().toLocaleLowerCase("es-CL")));
  const free = LABEL_SUGGESTIONS.find((label) => !taken.has(label.toLocaleLowerCase("es-CL")));
  if (free) return free;
  for (let n = 2; ; n++) {
    const label = `Dirección ${n}`;
    if (!taken.has(label.toLocaleLowerCase("es-CL"))) return label;
  }
}

/**
 * Body for POST/PUT /api/me/addresses. PUT replaces the whole address, so empty optional fields are sent
 * as "" (clears them) and a missing pin as null.
 */
export function toSavedAddressInput(values: { label: string } & AddressFields, location: GeoPoint | null): SavedAddressInput {
  return {
    label: values.label.trim(),
    address: values.address.trim(),
    unit: values.unit.trim(),
    reference: values.reference.trim(),
    location,
  };
}

// ── Order history ───────────────────────────────────────────────────────────

/**
 * Appends an older page ("Cargar más"). An order already listed is not repeated (a page answered twice,
 * e.g. after a retry, must not duplicate rows).
 */
export type HistoryTone = "active" | "done" | "failed";

/** How an order of the history looks: in progress (highlighted), finished, or rejected/cancelled. */
export function historyTone(status: OrderStatus): HistoryTone {
  if (status === "rejected" || status === "cancelled") return "failed";
  return FINAL_ORDER_STATUSES.includes(status) ? "done" : "active";
}

/** "1 producto", "3 productos". */
export function itemCountLabel(count: number): string {
  return `${count} ${count === 1 ? "producto" : "productos"}`;
}

export function appendOrdersPage(current: readonly CustomerOrderSummary[], page: CustomerOrdersPage): CustomerOrderSummary[] {
  const seen = new Set(current.map((order) => order.trackingToken));
  return [...current, ...page.items.filter((order) => !seen.has(order.trackingToken))];
}
