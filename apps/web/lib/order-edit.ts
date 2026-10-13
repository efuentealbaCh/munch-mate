import {
  type EditOrderItemsInput,
  ORDER_LIMITS,
  ORDER_STATUS_LABELS,
  type OrderItemView,
  type OrderView,
  type RestaurantRole,
} from "@app/types";
import { canEditOrder, isOrderEditable } from "@app/utils";
import { type CartLine, cartCount, cartTotal, type ItemLimit, toOrderItems } from "./cart";
import { cleanText } from "./clean-text";

/**
 * Staff editing an order's items from the board ("Modificar"): what the dialog keeps while the staff change
 * quantities, remove lines or add products, the estimated totals and the body of
 * `PUT /restaurants/:id/orders/:orderId/items`. The api prices the result; these totals are only estimates.
 */

/** What the edit dialog holds: the new quantity of each current line and the products added. */
export interface EditDraft {
  /** By index in `order.items`; 0 = removed. */
  quantities: number[];
  /** New lines, priced by the api against the current menu (the estimate uses the menu with its discounts). */
  added: CartLine[];
}

/**
 * Whether the board offers "Modificar": before the kitchen starts it, unpaid, and to the roles that work the
 * channel (the same checks as the api, which has the last word).
 */
export function canModifyOrder(order: Pick<OrderView, "status" | "paymentStatus" | "channel">, roles: readonly RestaurantRole[]): boolean {
  return isOrderEditable(order.status) && order.paymentStatus !== "paid" && canEditOrder(order.channel, roles);
}

/** The draft of an order as it is: every line with its quantity, nothing added. */
export function initialDraft(order: Pick<OrderView, "items">): EditDraft {
  return { quantities: order.items.map((item) => item.quantity), added: [] };
}

/** Price of a kept line at a new quantity: its snapshot scaled (it keeps the price it was ordered at). */
export function keptLineTotal(item: Pick<OrderItemView, "lineTotal" | "quantity">, quantity: number): number {
  if (item.quantity <= 0) return 0;
  return Math.round((item.lineTotal * quantity) / item.quantity);
}

/** Units the order would have (sum of quantities): what `maxItemsPerOrder` limits. */
export function draftUnits(draft: EditDraft): number {
  return draft.quantities.reduce((sum, quantity) => sum + quantity, 0) + cartCount(draft.added);
}

/** Where the edited order stands against the restaurant's units-per-order cap (same shape as the cart's). */
export function draftLimit(draft: EditDraft, max: number): ItemLimit {
  const count = draftUnits(draft);
  return { max, count, remaining: Math.max(0, max - count), exceeded: count > max };
}

/** Estimated subtotal: kept lines at their snapshot price, added lines at the menu's current price. */
export function draftSubtotal(order: Pick<OrderView, "items">, draft: EditDraft): number {
  const kept = order.items.reduce((sum, item, index) => sum + keptLineTotal(item, draft.quantities[index] ?? 0), 0);
  return kept + cartTotal(draft.added);
}

/** Whether the draft changes anything (a reason alone is not a change: the api answers NOTHING_CHANGED). */
export function hasDraftChanges(order: Pick<OrderView, "items">, draft: EditDraft): boolean {
  return draft.added.length > 0 || order.items.some((item, index) => (draft.quantities[index] ?? 0) !== item.quantity);
}

/** Every line removed and nothing added: the api refuses an empty order (ORDER_EMPTY); cancelling is the way. */
export function isDraftEmpty(draft: EditDraft): boolean {
  return draft.added.length === 0 && draft.quantities.every((quantity) => quantity === 0);
}

/** Sets the quantity of a current line (0 removes it), within 0…ORDER_LIMITS.quantityMax. */
export function setKeptQuantity(draft: EditDraft, line: number, quantity: number): EditDraft {
  const bounded = Math.min(ORDER_LIMITS.quantityMax, Math.max(0, Math.trunc(quantity)));
  return { ...draft, quantities: draft.quantities.map((current, index) => (index === line ? bounded : current)) };
}

/**
 * Body of the edit request. Removed lines are left out of `keep`; the reason is cleaned like the api does and
 * omitted when blank.
 * @param revision The `revision` of the order the dialog was opened on (a newer one answers ORDER_CHANGED).
 */
export function editInput(revision: number, draft: EditDraft, reason: string): EditOrderItemsInput {
  const keep = draft.quantities.flatMap((quantity, line) => (quantity > 0 ? [{ line, quantity }] : []));
  const cleaned = cleanText(reason).slice(0, ORDER_LIMITS.editReasonMax);
  return { revision, keep, add: toOrderItems(draft.added), ...(cleaned ? { reason: cleaned } : {}) };
}

/**
 * Why the dialog can no longer save: the live copy of the order moved on while it was open (another device
 * started it, charged it or edited it).
 * @param opened The order as it was when the dialog opened.
 * @param live The board's current copy (undefined once it left the board).
 * @returns A Spanish message for the dialog, or null while the edit can still be saved.
 */
export function editStaleReason(
  opened: Pick<OrderView, "revision">,
  live: Pick<OrderView, "status" | "paymentStatus" | "revision"> | undefined,
): string | null {
  if (!live) return "Este pedido cambió: ya no está en curso.";
  if (!isOrderEditable(live.status)) {
    return `Este pedido cambió a «${ORDER_STATUS_LABELS[live.status]}»: ya no se puede modificar.`;
  }
  if (live.paymentStatus === "paid") return "Este pedido cambió: ya está pagado y no se puede modificar.";
  if (live.revision !== opened.revision) return "Este pedido cambió: alguien más lo modificó. Carga la versión nueva para seguir.";
  return null;
}
