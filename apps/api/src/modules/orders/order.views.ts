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
    note: order.note,
    tableLabel: order.tableLabel,
    createdAt: order.createdAt.toISOString(),
  };
}

/** Customer view: no staff names, no internal ids, plus the reason if the order was rejected. */
export function toPublicOrderView(order: OrderRecord, restaurant: { name: string; slug: string }): PublicOrderView {
  const rejection = order.status === "rejected" ? order.statusHistory.findLast((c) => c.status === "rejected") : undefined;
  return {
    ticketNumber: order.ticketNumber,
    number: order.number,
    status: order.status,
    rejectReason: rejection?.reason ?? null,
    items: toItemViews(order),
    total: order.total,
    currency: order.currency,
    tableLabel: order.tableLabel,
    restaurant,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    cancellable: checkTransition(order.channel, order.status, "cancelled", { kind: "customer" }).ok,
  };
}
