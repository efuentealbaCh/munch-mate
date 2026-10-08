import type { OrderItemView, OrderView, PublicOrderView } from "@app/types";
import { checkTransition } from "@app/utils";
import type { OrderRecord } from "./orders.repository";

function toItemViews(order: OrderRecord): OrderItemView[] {
  return order.items.map((item) => ({
    productId: item.productId,
    name: item.name,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    note: item.note,
    lineTotal: item.lineTotal,
    modifiers: item.modifiers.map((m) => ({ groupName: m.groupName, optionName: m.optionName, priceDelta: m.priceDelta })),
  }));
}

/** A pickup order gets its PDF receipt when accepted; the worker stores it at `receiptKey(order)`. */
export function hasReceipt(order: OrderRecord): boolean {
  return order.channel !== "dine_in" && order.statusHistory.some((change) => change.status === "accepted");
}

/** Private-bucket key of an order's receipt (deterministic, so retries overwrite the same object). */
export function receiptKey(order: { restaurantId: string; id: string }): string {
  return `restaurants/${order.restaurantId}/receipts/${order.id}.pdf`;
}

/** Staff view: everything, including who changed each status. */
export function toOrderView(order: OrderRecord): OrderView {
  return {
    id: order.id,
    number: order.number,
    ticketNumber: order.ticketNumber,
    businessDate: order.businessDate,
    channel: order.channel,
    status: order.status,
    statusHistory: order.statusHistory.map((change) => ({
      status: change.status,
      at: change.at.toISOString(),
      byName: change.byName,
      ...(change.reason ? { reason: change.reason } : {}),
    })),
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    items: toItemViews(order),
    subtotal: order.subtotal,
    total: order.total,
    currency: order.currency,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    note: order.note,
    tableLabel: order.tableLabel,
    estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
    receiptAvailable: hasReceipt(order),
    createdAt: order.createdAt.toISOString(),
  };
}

/** Customer view: no staff names, no internal ids, plus the reason if the order was rejected. */
export function toPublicOrderView(
  order: OrderRecord,
  restaurant: { name: string; slug: string; phone: string },
): PublicOrderView {
  const rejection = order.status === "rejected" ? order.statusHistory.findLast((c) => c.status === "rejected") : undefined;
  return {
    ticketNumber: order.ticketNumber,
    number: order.number,
    channel: order.channel,
    status: order.status,
    rejectReason: rejection?.reason ?? null,
    items: toItemViews(order),
    total: order.total,
    currency: order.currency,
    tableLabel: order.tableLabel,
    estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
    receiptAvailable: hasReceipt(order),
    restaurant,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    cancellable: checkTransition(order.channel, order.status, "cancelled", { kind: "customer" }).ok,
  };
}
