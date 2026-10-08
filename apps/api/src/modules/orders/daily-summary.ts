import { type DailySummary, FINAL_ORDER_STATUSES, ORDER_CHANNELS, PAYMENT_METHODS } from "@app/types";
import type { OrderRecord } from "./orders.repository";

const TOP_PRODUCTS = 5;

/**
 * Sales of one business day from its orders. Rejected and cancelled orders are only counted, never summed;
 * orders still in progress count as sales (they are expected to be paid). Paid amounts are split by method.
 */
export function summarizeDay(orders: readonly OrderRecord[], date: string, currency: string): DailySummary {
  const summary: DailySummary = {
    date,
    currency,
    orders: { total: orders.length, completed: 0, inProgress: 0, cancelled: 0, rejected: 0 },
    sales: { total: 0, deliveryFees: 0, paid: 0, unpaid: 0, averageTicket: 0 },
    byChannel: Object.fromEntries(ORDER_CHANNELS.map((c) => [c, { orders: 0, total: 0 }])) as DailySummary["byChannel"],
    byPaymentMethod: Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as DailySummary["byPaymentMethod"],
    topProducts: [],
  };
  const products = new Map<string, { name: string; quantity: number; total: number }>();
  let counted = 0;

  for (const order of orders) {
    if (order.status === "cancelled") {
      summary.orders.cancelled++;
      continue;
    }
    if (order.status === "rejected") {
      summary.orders.rejected++;
      continue;
    }
    if (FINAL_ORDER_STATUSES.includes(order.status)) summary.orders.completed++;
    else summary.orders.inProgress++;

    counted++;
    summary.sales.total += order.total;
    summary.sales.deliveryFees += order.deliveryFee;
    summary.byChannel[order.channel].orders++;
    summary.byChannel[order.channel].total += order.total;
    if (order.paymentStatus === "paid") {
      summary.sales.paid += order.total;
      if (order.paymentMethod) summary.byPaymentMethod[order.paymentMethod] += order.total;
    } else {
      summary.sales.unpaid += order.total;
    }

    for (const item of order.items) {
      // By product id: the same product under a renamed name still adds up (the latest name is shown).
      const entry = products.get(item.productId) ?? { name: item.name, quantity: 0, total: 0 };
      entry.name = item.name;
      entry.quantity += item.quantity;
      entry.total += item.lineTotal;
      products.set(item.productId, entry);
    }
  }

  summary.sales.averageTicket = counted > 0 ? Math.round(summary.sales.total / counted) : 0;
  summary.topProducts = [...products.values()]
    .sort((a, b) => b.quantity - a.quantity || b.total - a.total)
    .slice(0, TOP_PRODUCTS);
  return summary;
}
