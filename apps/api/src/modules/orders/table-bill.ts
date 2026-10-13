import { type BillLine, FINAL_ORDER_STATUSES, type PublicTableBill, type TableSessionView } from "@app/types";
import { suggestedTip } from "@app/utils";
import type { OrderRecord } from "./orders.repository";
import type { TableSessionRecord } from "./table-sessions.repository";

/** Orders that never reached the table do not count on the bill. */
const counts = (order: OrderRecord) => order.status !== "rejected" && order.status !== "cancelled";

export interface BillTotals {
  lines: BillLine[];
  orderCount: number;
  ordersInProgress: number;
  unpaidOrders: number;
  subtotal: number;
}

/**
 * Adds up a table account: the same product with the same options in several orders becomes one line, in
 * the order it was first asked for. Rejected and cancelled orders are left out.
 */
export function billTotals(orders: readonly OrderRecord[]): BillTotals {
  const lines = new Map<string, BillLine>();
  let subtotal = 0;
  let orderCount = 0;
  let ordersInProgress = 0;
  let unpaidOrders = 0;
  for (const order of [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!counts(order)) continue;
    orderCount++;
    subtotal += order.total;
    if (!FINAL_ORDER_STATUSES.includes(order.status)) ordersInProgress++;
    if (order.paymentStatus !== "paid") unpaidOrders++;
    for (const item of order.items) {
      const options = item.modifiers.map((m) => `${m.groupName}: ${m.optionName}`);
      // Same product, options and price: one line. A different price (a discount that ended) is another line.
      const key = [item.productId, item.unitPrice, ...item.modifiers.map((m) => m.optionId)].join("|");
      const line = lines.get(key) ?? { name: item.name, options, quantity: 0, total: 0 };
      line.quantity += item.quantity;
      line.total += item.lineTotal;
      lines.set(key, line);
    }
  }
  return { lines: [...lines.values()], orderCount, ordersInProgress, unpaidOrders, subtotal };
}

/** The account as the floor staff see it. */
export function toTableSessionView(
  session: TableSessionRecord,
  orders: readonly OrderRecord[],
  restaurant: { currency: string; tipPercent: number },
): TableSessionView {
  const totals = billTotals(orders);
  return {
    id: session.id,
    tableId: session.tableId,
    tableLabel: session.tableLabel,
    status: session.status,
    openedAt: session.openedAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
    lines: totals.lines,
    orderIds: orders.map((o) => o.id),
    orderCount: totals.orderCount,
    ordersInProgress: totals.ordersInProgress,
    unpaidOrders: totals.unpaidOrders,
    subtotal: totals.subtotal,
    currency: restaurant.currency,
    tipPercent: restaurant.tipPercent,
    suggestedTip: suggestedTip(totals.subtotal, restaurant.tipPercent),
    waiterCalledAt: session.waiterCalledAt?.toISOString() ?? null,
    billRequestedAt: session.billRequestedAt?.toISOString() ?? null,
    requestedTip: session.requestedTip,
    tip: session.tip,
    paymentMethod: session.paymentMethod,
    closedByName: session.closedByName,
  };
}

/** The account as the phones at the table see it: no names, no ids. */
export function toPublicTableBill(
  tableLabel: string,
  session: TableSessionRecord | null,
  orders: readonly OrderRecord[],
  restaurant: { currency: string; tipPercent: number },
): PublicTableBill {
  const totals = billTotals(session ? orders : []);
  return {
    tableLabel,
    open: session?.status === "open",
    lines: totals.lines,
    orderCount: totals.orderCount,
    ordersInProgress: totals.ordersInProgress,
    subtotal: totals.subtotal,
    currency: restaurant.currency,
    tipPercent: restaurant.tipPercent,
    suggestedTip: suggestedTip(totals.subtotal, restaurant.tipPercent),
    waiterCalledAt: session?.waiterCalledAt?.toISOString() ?? null,
    billRequestedAt: session?.billRequestedAt?.toISOString() ?? null,
    requestedTip: session?.requestedTip ?? null,
    closedAt: session?.status === "closed" ? (session.closedAt?.toISOString() ?? null) : null,
  };
}
