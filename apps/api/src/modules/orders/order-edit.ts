import type { PricedItem } from "./order-pricing";

/** A current line the staff keep, by its index in the order's items, with its new quantity. */
export interface KeptLine {
  line: number;
  quantity: number;
}

/** The edit does not make sense for this order. `code` is returned to the client as the api error code. */
export class OrderEditError extends Error {
  constructor(
    readonly code: "INVALID_EDIT" | "ORDER_EMPTY" | "NOTHING_CHANGED",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Validates which lines an edit keeps, before pricing the new ones (cheap checks first).
 * @param items The order's current lines.
 * @param adding How many new lines the edit adds.
 * @throws OrderEditError INVALID_EDIT (repeated or unknown line), ORDER_EMPTY (nothing left), NOTHING_CHANGED.
 */
export function checkEdit(items: readonly PricedItem[], keep: readonly KeptLine[], adding: number): void {
  const seen = new Set<number>();
  for (const { line } of keep) {
    if (!Number.isInteger(line) || line < 0 || line >= items.length || seen.has(line)) {
      throw new OrderEditError("INVALID_EDIT", "Las líneas del pedido cambiaron; recarga e inténtalo de nuevo");
    }
    seen.add(line);
  }
  if (keep.length === 0 && adding === 0) {
    throw new OrderEditError("ORDER_EMPTY", "Un pedido no puede quedar vacío; si ya no lo quieren, cancélalo");
  }
  const unchanged =
    adding === 0 && keep.length === items.length && keep.every((k) => items[k.line]!.quantity === k.quantity);
  if (unchanged) throw new OrderEditError("NOTHING_CHANGED", "No hiciste cambios en el pedido");
}

/**
 * Applies an edit: the kept lines keep their price snapshot (only the quantity and line total change), in
 * their original order, followed by the new lines (already priced against the current menu).
 * @returns The new lines, their subtotal and the readable changes stored in the order's edit history.
 * @throws OrderEditError as `checkEdit`.
 */
export function applyEdit(
  items: readonly PricedItem[],
  keep: readonly KeptLine[],
  added: readonly PricedItem[],
): { items: PricedItem[]; subtotal: number; changes: string[] } {
  checkEdit(items, keep, added.length);
  const quantityOf = new Map(keep.map((k) => [k.line, k.quantity]));

  const kept: PricedItem[] = [];
  const changes: string[] = [];
  items.forEach((item, line) => {
    const quantity = quantityOf.get(line);
    if (quantity === undefined) {
      changes.push(`−${item.quantity} ${lineLabel(item)}`);
      return;
    }
    if (quantity !== item.quantity) changes.push(`${lineLabel(item)}: ${item.quantity} → ${quantity}`);
    // lineTotal = (unit price + option extras) × quantity, so dividing gives back the exact unit amount.
    // Rounded anyway so money stays an integer even if an old line was stored inconsistently.
    kept.push({ ...item, quantity, lineTotal: Math.round((item.lineTotal / item.quantity) * quantity) });
  });
  for (const item of added) changes.push(`+${item.quantity} ${lineLabel(item)}`);

  const result = [...kept, ...added];
  return { items: result, subtotal: result.reduce((sum, item) => sum + item.lineTotal, 0), changes };
}

/** "Pizza Margarita (Familiar, Extra queso)": the product and its chosen options. */
export function lineLabel(item: Pick<PricedItem, "name" | "modifiers">): string {
  return item.modifiers.length ? `${item.name} (${item.modifiers.map((m) => m.optionName).join(", ")})` : item.name;
}
