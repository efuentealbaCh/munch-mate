import { ORDER_LIMITS, type OrderItemInput, type PublicModifierGroup, type PublicProduct } from "@app/types";

/**
 * Customer cart for dine-in orders: modifier selection rules, line prices and the cart reducer.
 * Prices here are ESTIMATES for display: the api prices every order from the current menu and its answer
 * is the truth (the cart only sends ids and quantities).
 */

// ── Modifier selection ──────────────────────────────────────────────────────

/** Chosen option ids per modifier group id. */
export type ModifierSelection = Record<string, string[]>;

/** Single choice (radio) when the group allows only one option; checkboxes otherwise. */
export function isSingleChoice(group: Pick<PublicModifierGroup, "maxSelect">): boolean {
  return group.maxSelect === 1;
}

/**
 * Applies a tap on an option. Radio groups replace the choice; checkbox groups add/remove, never beyond
 * `maxSelect`. Sold-out or unknown options are ignored.
 * @returns A new selection (the input is not modified).
 */
export function toggleOption(
  selection: ModifierSelection,
  group: PublicModifierGroup,
  optionId: string,
  checked: boolean,
): ModifierSelection {
  const option = group.options.find((o) => o.id === optionId);
  if (!option?.available) return selection;
  const current = selection[group.id] ?? [];
  let next: string[];
  if (isSingleChoice(group)) {
    next = checked ? [optionId] : current.filter((id) => id !== optionId);
  } else if (checked) {
    if (current.includes(optionId) || current.length >= group.maxSelect) return selection;
    next = [...current, optionId];
  } else {
    next = current.filter((id) => id !== optionId);
  }
  return { ...selection, [group.id]: next };
}

/**
 * Whether an option cannot be chosen right now: sold out, or a checkbox group already at its maximum
 * (the chosen ones stay enabled so they can be unchecked).
 */
export function isOptionDisabled(selection: ModifierSelection, group: PublicModifierGroup, optionId: string): boolean {
  const option = group.options.find((o) => o.id === optionId);
  if (!option?.available) return true;
  if (isSingleChoice(group)) return false;
  const current = selection[group.id] ?? [];
  return !current.includes(optionId) && current.length >= group.maxSelect;
}

/** Groups whose minimum is not reached yet (the "Agregar" button stays disabled while any is left). */
export function missingGroups(product: Pick<PublicProduct, "modifierGroups">, selection: ModifierSelection): PublicModifierGroup[] {
  return product.modifierGroups.filter((group) => (selection[group.id]?.length ?? 0) < group.minSelect);
}

/**
 * A required group whose available options cannot reach its minimum (everything sold out): the product
 * cannot be ordered at all until the restaurant restocks.
 */
export function blockedGroups(product: Pick<PublicProduct, "modifierGroups">): PublicModifierGroup[] {
  return product.modifierGroups.filter((group) => group.options.filter((o) => o.available).length < group.minSelect);
}

/** A chosen option with the names and price needed to show and price the cart line. */
export interface CartModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
}

/**
 * Resolves a selection into display/price data, in the product's group order and each group's option
 * order (the same order the api stores in the order snapshot). Unknown ids are dropped.
 */
export function resolveModifiers(product: Pick<PublicProduct, "modifierGroups">, selection: ModifierSelection): CartModifier[] {
  const chosen: CartModifier[] = [];
  for (const group of product.modifierGroups) {
    const ids = selection[group.id] ?? [];
    for (const option of group.options) {
      if (!ids.includes(option.id)) continue;
      chosen.push({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        priceDelta: option.priceDelta,
      });
    }
  }
  return chosen;
}

/** Product price plus every chosen option's delta (integers, minor units). */
export function unitPrice(basePrice: number, modifiers: readonly Pick<CartModifier, "priceDelta">[]): number {
  return basePrice + modifiers.reduce((sum, modifier) => sum + modifier.priceDelta, 0);
}

/** Keeps a quantity inside 1…ORDER_LIMITS.quantityMax (and an integer). */
export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(ORDER_LIMITS.quantityMax, Math.max(1, Math.trunc(quantity)));
}

// ── Cart ────────────────────────────────────────────────────────────────────

export interface CartLine {
  /** Same product + same options + same note → same key (adding it again increases the quantity). */
  key: string;
  productId: string;
  name: string;
  basePrice: number;
  modifiers: CartModifier[];
  note: string;
  quantity: number;
}

/** Identity of a line: product, options (order-independent) and note. */
export function lineKey(productId: string, modifiers: readonly Pick<CartModifier, "optionId">[], note: string): string {
  const options = modifiers.map((m) => m.optionId).sort().join(",");
  return `${productId}|${options}|${note.trim()}`;
}

export function lineTotal(line: Pick<CartLine, "basePrice" | "modifiers" | "quantity">): number {
  return unitPrice(line.basePrice, line.modifiers) * line.quantity;
}

export function cartTotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

/** Number of units (what the "Ver pedido (3)" bar shows). */
export function cartCount(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/** Builds a cart line from the product sheet. */
export function createLine(
  product: Pick<PublicProduct, "id" | "name" | "price" | "modifierGroups">,
  selection: ModifierSelection,
  quantity: number,
  note: string,
): CartLine {
  const modifiers = resolveModifiers(product, selection);
  const trimmed = note.trim().slice(0, ORDER_LIMITS.noteMax);
  return {
    key: lineKey(product.id, modifiers, trimmed),
    productId: product.id,
    name: product.name,
    basePrice: product.price,
    modifiers,
    note: trimmed,
    quantity: clampQuantity(quantity),
  };
}

export type CartAction =
  | { type: "add"; line: CartLine }
  | { type: "setQuantity"; key: string; quantity: number }
  | { type: "remove"; key: string }
  /** Removes every line of a product (the api said it can no longer be ordered). */
  | { type: "removeProduct"; productId: string }
  | { type: "clear" }
  | { type: "replace"; lines: CartLine[] };

/**
 * Cart reducer. Adding an identical line merges quantities (capped at the api's maximum); the cart never
 * exceeds ORDER_LIMITS.itemsMax lines (extra adds are ignored — the UI warns before that).
 */
export function cartReducer(lines: CartLine[], action: CartAction): CartLine[] {
  switch (action.type) {
    case "add": {
      const existing = lines.find((line) => line.key === action.line.key);
      if (existing) {
        return lines.map((line) =>
          line.key === action.line.key ? { ...line, quantity: clampQuantity(line.quantity + action.line.quantity) } : line,
        );
      }
      if (lines.length >= ORDER_LIMITS.itemsMax) return lines;
      return [...lines, { ...action.line, quantity: clampQuantity(action.line.quantity) }];
    }
    case "setQuantity":
      return lines.map((line) => (line.key === action.key ? { ...line, quantity: clampQuantity(action.quantity) } : line));
    case "remove":
      return lines.filter((line) => line.key !== action.key);
    case "removeProduct":
      return lines.filter((line) => line.productId !== action.productId);
    case "clear":
      return [];
    case "replace":
      return action.lines;
  }
}

/** What the api receives: ids and quantities only, modifiers grouped by group. */
export function toOrderItems(lines: readonly CartLine[]): OrderItemInput[] {
  return lines.map((line) => {
    const byGroup = new Map<string, string[]>();
    for (const modifier of line.modifiers) {
      byGroup.set(modifier.groupId, [...(byGroup.get(modifier.groupId) ?? []), modifier.optionId]);
    }
    return {
      productId: line.productId,
      quantity: line.quantity,
      modifiers: [...byGroup].map(([groupId, optionIds]) => ({ groupId, optionIds })),
      ...(line.note ? { note: line.note } : {}),
    };
  });
}

// ── Persistence (sessionStorage) ────────────────────────────────────────────

/** Bump when the stored shape changes: older carts are then discarded instead of misread. */
const CART_VERSION = 1;

export const cartStorageKey = (tableToken: string) => `mm:cart:${tableToken}`;

/** Minimal Storage surface, so tests can pass a Map-backed fake. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function serializeCart(lines: readonly CartLine[]): string {
  return JSON.stringify({ v: CART_VERSION, lines });
}

const isString = (value: unknown): value is string => typeof value === "string";
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

function parseModifier(value: unknown): CartModifier | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  if (!isString(m.groupId) || !isString(m.groupName) || !isString(m.optionId) || !isString(m.optionName)) return null;
  if (!isInt(m.priceDelta) || m.priceDelta < 0) return null;
  return { groupId: m.groupId, groupName: m.groupName, optionId: m.optionId, optionName: m.optionName, priceDelta: m.priceDelta };
}

function parseLine(value: unknown): CartLine | null {
  if (typeof value !== "object" || value === null) return null;
  const l = value as Record<string, unknown>;
  if (!isString(l.productId) || !isString(l.name) || !isInt(l.basePrice) || l.basePrice < 0) return null;
  if (!isInt(l.quantity) || !Array.isArray(l.modifiers)) return null;
  const modifiers = l.modifiers.map(parseModifier);
  if (modifiers.some((m) => m === null)) return null;
  const note = isString(l.note) ? l.note.slice(0, ORDER_LIMITS.noteMax) : "";
  const valid = modifiers as CartModifier[];
  return {
    key: lineKey(l.productId, valid, note),
    productId: l.productId,
    name: l.name,
    basePrice: l.basePrice,
    modifiers: valid,
    note,
    quantity: clampQuantity(l.quantity),
  };
}

/**
 * Reads a stored cart. Anything malformed (other version, edited by hand, truncated) yields an empty cart
 * rather than an error: losing a cart is better than a broken page.
 */
export function deserializeCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as { v?: unknown; lines?: unknown };
    if (data.v !== CART_VERSION || !Array.isArray(data.lines)) return [];
    const lines = data.lines.map(parseLine).filter((line): line is CartLine => line !== null);
    // Re-merge in case two stored lines ended up with the same key.
    return lines.reduce<CartLine[]>((cart, line) => cartReducer(cart, { type: "add", line }), []);
  } catch {
    return [];
  }
}

/** Storage can throw (Safari private mode, quota, disabled storage): the cart then lives in memory only. */
export function loadCart(storage: KeyValueStorage | undefined, tableToken: string): CartLine[] {
  try {
    return deserializeCart(storage?.getItem(cartStorageKey(tableToken)) ?? null);
  } catch {
    return [];
  }
}

export function saveCart(storage: KeyValueStorage | undefined, tableToken: string, lines: readonly CartLine[]): void {
  try {
    if (lines.length === 0) storage?.removeItem(cartStorageKey(tableToken));
    else storage?.setItem(cartStorageKey(tableToken), serializeCart(lines));
  } catch {
    // Not fatal: see loadCart.
  }
}

// ── Idempotent submission ───────────────────────────────────────────────────

/**
 * Random UUID v4 for `clientOrderId`. crypto.randomUUID needs a secure context (https or localhost); a
 * phone testing the dev server over the LAN (plain http) gets the getRandomValues fallback.
 */
export function newClientOrderId(cryptoImpl: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = crypto): string {
  if (typeof cryptoImpl.randomUUID === "function") return cryptoImpl.randomUUID();
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The id used for the last submission and what was submitted with it. */
export interface CheckoutAttempt {
  clientOrderId: string;
  /** Serialized order (without the id): the same content means "a retry of the same submission". */
  fingerprint: string;
}

/** Stable serialization of what the customer is sending. */
export function checkoutFingerprint(input: { items: OrderItemInput[]; customerName?: string; note?: string }): string {
  return JSON.stringify([input.items, input.customerName ?? "", input.note ?? ""]);
}

/**
 * Chooses the `clientOrderId` for a submission. A retry of the same content (network error, double tap,
 * reload after a failure) reuses the previous id, so the api answers with the order it may already have
 * created instead of duplicating it. Changed content is a new submission and gets a new id.
 */
export function pickClientOrderId(previous: CheckoutAttempt | null, fingerprint: string, makeId: () => string): CheckoutAttempt {
  if (previous && previous.fingerprint === fingerprint) return previous;
  return { clientOrderId: makeId(), fingerprint };
}

export const checkoutStorageKey = (tableToken: string) => `mm:checkout:${tableToken}`;

export function loadCheckoutAttempt(storage: KeyValueStorage | undefined, tableToken: string): CheckoutAttempt | null {
  try {
    const raw = storage?.getItem(checkoutStorageKey(tableToken));
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<CheckoutAttempt>;
    return typeof data.clientOrderId === "string" && typeof data.fingerprint === "string"
      ? { clientOrderId: data.clientOrderId, fingerprint: data.fingerprint }
      : null;
  } catch {
    return null;
  }
}

/** Pass null after a successful order (the next cart is a new submission). */
export function saveCheckoutAttempt(storage: KeyValueStorage | undefined, tableToken: string, attempt: CheckoutAttempt | null): void {
  try {
    if (attempt) storage?.setItem(checkoutStorageKey(tableToken), JSON.stringify(attempt));
    else storage?.removeItem(checkoutStorageKey(tableToken));
  } catch {
    // Not fatal: retries within this page still reuse the in-memory attempt.
  }
}
