import {
  type BillLine,
  type EqualPartView,
  FINAL_ORDER_STATUSES,
  type PublicTableBill,
  type TableSessionView,
} from "@app/types";
import { equalSplitState, suggestedTip } from "@app/utils";
import type { OrderRecord } from "./orders.repository";
import type { TablePaymentRecord, TableSessionRecord } from "./table-sessions.repository";
import { countsOnBill, itemLines, lineKey, paidAmount, paidEqualParts, paidQuantities, remaining } from "./table-split";

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
 * @param payments The account's payments: units paid by products (and every unit of orders already paid)
 *   show up as `paidQuantity`.
 */
export function billTotals(
  orders: readonly OrderRecord[],
  payments: readonly Pick<TablePaymentRecord, "items">[] = [],
): BillTotals {
  const paid = paidQuantities(payments);
  const lines = new Map<string, BillLine>();
  let subtotal = 0;
  let orderCount = 0;
  let ordersInProgress = 0;
  let unpaidOrders = 0;
  for (const order of [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!countsOnBill(order)) continue;
    orderCount++;
    subtotal += order.total;
    if (!FINAL_ORDER_STATUSES.includes(order.status)) ordersInProgress++;
    if (order.paymentStatus !== "paid") unpaidOrders++;
    for (const [index, item] of order.items.entries()) {
      const options = item.modifiers.map((m) => `${m.groupName}: ${m.optionName}`);
      // Same product, options and price: one line. A different price (a discount that ended) is another line.
      const key = [item.productId, item.unitPrice, ...item.modifiers.map((m) => m.optionId)].join("|");
      const line = lines.get(key) ?? { name: item.name, options, quantity: 0, paidQuantity: 0, total: 0 };
      line.quantity += item.quantity;
      line.paidQuantity +=
        order.paymentStatus === "paid" ? item.quantity : Math.min(item.quantity, paid.get(lineKey(order.id, index)) ?? 0);
      line.total += item.lineTotal;
      lines.set(key, line);
    }
  }
  return { lines: [...lines.values()], orderCount, ordersInProgress, unpaidOrders, subtotal };
}

/** Payments, what is left and the equal parts of an account, as both views show them. */
function splitState(session: TableSessionRecord, orders: readonly OrderRecord[]) {
  const open = session.status === "open";
  // Once closed, the orders are paid and nothing is left; never shown negative (see TableSessionView.remaining).
  const left = open ? Math.max(0, remaining(orders, session.payments)) : 0;
  const equalPart: EqualPartView | null =
    open && session.split?.mode === "equal"
      ? equalSplitState(left, session.split.parts, paidEqualParts(session.payments))
      : null;
  return { paid: paidAmount(session.payments), remaining: left, equalPart };
}

const itemCount = (payment: TablePaymentRecord) => payment.items.reduce((sum, item) => sum + item.quantity, 0);

/** The account as the floor staff see it. */
export function toTableSessionView(
  session: TableSessionRecord,
  orders: readonly OrderRecord[],
  restaurant: { currency: string; tipPercent: number },
): TableSessionView {
  const totals = billTotals(orders, session.payments);
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
    paymentMethods: session.paymentMethods,
    closedByName: session.closedByName,
    split: session.split,
    payments: session.payments.map((payment) => ({
      id: payment.id,
      kind: payment.kind,
      amount: payment.amount,
      tip: payment.tip,
      method: payment.method,
      part: payment.part,
      itemCount: itemCount(payment),
      items: payment.items.map((item) => ({ ...item })),
      at: payment.at.toISOString(),
      byName: payment.byName,
    })),
    ...splitState(session, orders),
    itemLines: itemLines(orders, session.payments),
  };
}

/** The account as the phones at the table see it: no names, no ids. */
export function toPublicTableBill(
  tableLabel: string,
  session: TableSessionRecord | null,
  orders: readonly OrderRecord[],
  restaurant: { currency: string; tipPercent: number },
): PublicTableBill {
  const totals = billTotals(session ? orders : [], session?.payments ?? []);
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
    split: session?.split ?? null,
    payments: (session?.payments ?? []).map((payment) => ({
      kind: payment.kind,
      amount: payment.amount,
      method: payment.method,
      part: payment.part,
      itemCount: itemCount(payment),
    })),
    ...(session ? splitState(session, orders) : { paid: 0, remaining: 0, equalPart: null }),
  };
}
