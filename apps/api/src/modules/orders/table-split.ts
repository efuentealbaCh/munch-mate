import type { BillItemLine, PaymentMethod, PaymentPortion, TablePaymentItem } from "@app/types";
import type { OrderRecord } from "./orders.repository";
import type { TablePaymentRecord } from "./table-sessions.repository";

/**
 * Split table accounts: the pure rules behind partial payments (equal parts, by products, free amounts).
 * Amounts are integers in the currency's minor unit; payment amounts never include the tip.
 */

/** Orders that never reached the table do not count on the bill. */
export const countsOnBill = (order: Pick<OrderRecord, "status">): boolean =>
  order.status !== "rejected" && order.status !== "cancelled";

const byCreation = (a: OrderRecord, b: OrderRecord) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/**
 * Orders the account still has to charge, oldest first: they count and were not paid on their own (a waiter
 * may register the payment of one order before the table asks for the bill).
 */
export function dueOrders(orders: readonly OrderRecord[]): OrderRecord[] {
  return orders.filter((order) => countsOnBill(order) && order.paymentStatus !== "paid").sort(byCreation);
}

/** Σ amount of the payments (tips apart). */
export function paidAmount(payments: readonly Pick<TablePaymentRecord, "amount">[]): number {
  return payments.reduce((sum, payment) => sum + payment.amount, 0);
}

/**
 * What is left to pay: the orders due minus the payments. Negative when an order was cancelled after being
 * paid for (the staff must delete a payment before closing).
 */
export function remaining(orders: readonly OrderRecord[], payments: readonly Pick<TablePaymentRecord, "amount">[]): number {
  return dueOrders(orders).reduce((sum, order) => sum + order.total, 0) - paidAmount(payments);
}

/** Key of one line of one order. */
export const lineKey = (orderId: string, line: number): string => `${orderId}:${line}`;

/** Units paid per line (`lineKey`) by "pay by products" payments. */
export function paidQuantities(payments: readonly Pick<TablePaymentRecord, "items">[]): Map<string, number> {
  const paid = new Map<string, number>();
  for (const payment of payments) {
    for (const item of payment.items) {
      const key = lineKey(item.orderId, item.line);
      paid.set(key, (paid.get(key) ?? 0) + item.quantity);
    }
  }
  return paid;
}

/** Parts of an equal split already paid (1-based). */
export function paidEqualParts(payments: readonly Pick<TablePaymentRecord, "kind" | "part">[]): number[] {
  return payments.filter((p) => p.kind === "equal" && p.part !== null).map((p) => p.part!);
}

/** What one unit of a line costs, options included (lineTotal is always unit × quantity). */
const unitAmount = (item: { lineTotal: number; quantity: number }) => item.lineTotal / item.quantity;

/** A selection of products that cannot be paid (stale screen, forged request). */
export class SplitError extends Error {
  readonly code = "INVALID_SPLIT_ITEMS";
}

/**
 * The amount of a "pay by products" payment: Σ unit amount × quantity of each line chosen. Repeated lines
 * add up.
 * @throws SplitError when a line is not in an order due on the account, or more units are chosen than are
 *   left unpaid on it.
 */
export function itemsAmount(
  orders: readonly OrderRecord[],
  payments: readonly Pick<TablePaymentRecord, "items">[],
  items: readonly TablePaymentItem[],
): number {
  if (items.length === 0) throw new SplitError("Elige al menos un producto");
  const due = new Map(dueOrders(orders).map((order) => [order.id, order]));
  const chosen = new Map<string, TablePaymentItem>();
  for (const item of items) {
    const key = lineKey(item.orderId, item.line);
    const previous = chosen.get(key);
    chosen.set(key, { ...item, quantity: (previous?.quantity ?? 0) + item.quantity });
  }
  const alreadyPaid = paidQuantities(payments);
  let amount = 0;
  for (const [key, item] of chosen) {
    const line = due.get(item.orderId)?.items[item.line];
    if (!line || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new SplitError("Uno de los productos elegidos ya no está en la cuenta; revisa la cuenta");
    }
    if (item.quantity > line.quantity - (alreadyPaid.get(key) ?? 0)) {
      throw new SplitError(`Quedan menos unidades por pagar de ${line.name}; revisa la cuenta`);
    }
    amount += Math.round(unitAmount(line) * item.quantity);
  }
  return amount;
}

/**
 * The lines of the account per order, not grouped (what "pay by products" chooses from), oldest order first.
 * Orders already paid show every unit as paid.
 */
export function itemLines(orders: readonly OrderRecord[], payments: readonly Pick<TablePaymentRecord, "items">[]): BillItemLine[] {
  const paid = paidQuantities(payments);
  return [...orders]
    .filter(countsOnBill)
    .sort(byCreation)
    .flatMap((order) =>
      order.items.map((item, line) => ({
        orderId: order.id,
        line,
        name: item.name,
        options: item.modifiers.map((m) => `${m.groupName}: ${m.optionName}`),
        quantity: item.quantity,
        paidQuantity:
          order.paymentStatus === "paid" ? item.quantity : Math.min(item.quantity, paid.get(lineKey(order.id, line)) ?? 0),
        unitAmount: unitAmount(item),
        total: item.lineTotal,
      })),
    );
}

/** The different methods of the payments, in order of first use. */
export function methodsOf(payments: readonly Pick<TablePaymentRecord, "method">[]): PaymentMethod[] {
  return [...new Set(payments.map((payment) => payment.method))];
}

/** The method of the largest portion (the first one on ties), or null without portions. */
export function mainMethod(breakdown: readonly PaymentPortion[]): PaymentMethod | null {
  let main: PaymentPortion | null = null;
  for (const portion of breakdown) if (!main || portion.amount > main.amount) main = portion;
  return main?.method ?? null;
}

/**
 * Splits the payments among the orders due when the account closes, so each order records how it was paid.
 * "Pay by products" payments go first to the orders of their lines (as far as those orders still have room);
 * then every payment, in the order it was registered, fills the orders oldest first (a payment may be split
 * between orders). With Σ payments = Σ orders due, each order's portions add up to its total.
 * @returns Per order id, its portions (one per method, in order of first use); orders with total 0 get [].
 */
export function allocatePayments(
  orders: readonly OrderRecord[],
  payments: readonly TablePaymentRecord[],
): Map<string, PaymentPortion[]> {
  const targets = dueOrders(orders);
  const room = new Map(targets.map((order) => [order.id, order.total]));
  const portions = new Map<string, Map<PaymentMethod, number>>(targets.map((order) => [order.id, new Map()]));
  const assign = (orderId: string, method: PaymentMethod, wanted: number): number => {
    const amount = Math.min(wanted, room.get(orderId) ?? 0);
    if (amount <= 0) return 0;
    room.set(orderId, room.get(orderId)! - amount);
    const byMethod = portions.get(orderId)!;
    byMethod.set(method, (byMethod.get(method) ?? 0) + amount);
    return amount;
  };

  const left = payments.map((payment) => payment.amount);
  payments.forEach((payment, i) => {
    if (payment.kind !== "items") return;
    for (const item of payment.items) {
      const line = targets.find((order) => order.id === item.orderId)?.items[item.line];
      if (!line) continue;
      left[i]! -= assign(item.orderId, payment.method, Math.min(left[i]!, Math.round(unitAmount(line) * item.quantity)));
    }
  });
  payments.forEach((payment, i) => {
    for (const order of targets) {
      if (left[i]! <= 0) break;
      left[i]! -= assign(order.id, payment.method, left[i]!);
    }
  });

  return new Map(
    [...portions].map(([orderId, byMethod]) => [orderId, [...byMethod].map(([method, amount]) => ({ method, amount }))]),
  );
}
