import { FINAL_ORDER_STATUSES, type OrderChannel, type OrderStatus, type PaymentMethod } from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type ClientSession, type Model, Types } from "mongoose";
import type { PricedItem } from "./order-pricing";
import { Order } from "./schemas/order.schema";

export interface StatusChangeRecord {
  status: OrderStatus;
  at: Date;
  byUserId: string | null;
  byName: string | null;
  reason: string | null;
}

export interface OrderRecord {
  id: string;
  restaurantId: string;
  number: number;
  ticketNumber: number;
  businessDate: string;
  channel: OrderChannel;
  status: OrderStatus;
  statusHistory: StatusChangeRecord[];
  paymentStatus: "unpaid" | "paid";
  paymentMethod: PaymentMethod | null;
  items: PricedItem[];
  subtotal: number;
  total: number;
  currency: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  note: string;
  tableId: string | null;
  tableLabel: string | null;
  estimatedReadyAt: Date | null;
  /** Browser-generated submission id; with ORDER_TOKEN_SECRET it re-derives the customer's access token. */
  clientOrderId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewOrder {
  number: number;
  ticketNumber: number;
  businessDate: string;
  channel: OrderChannel;
  items: PricedItem[];
  subtotal: number;
  total: number;
  currency: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  note: string;
  tableId: string | null;
  tableLabel: string | null;
  accessTokenHash: string;
  clientOrderId: string;
}

const oid = (id: string) => new Types.ObjectId(id);
export const DUPLICATE_KEY = 11000;

/** Tenant-scoped, except the lookup by access token used by the customer's tracking page. */
@Injectable()
export class OrdersRepository {
  constructor(@InjectModel(Order.name) private readonly orders: Model<Order>) {}

  /** @throws MongoServerError 11000 when `clientOrderId` was already used (a retried submission). */
  async create(restaurantId: string, input: NewOrder, session: ClientSession): Promise<OrderRecord> {
    const [doc] = await this.orders.create(
      [
        {
          ...input,
          restaurantId: oid(restaurantId),
          tableId: input.tableId ? oid(input.tableId) : null,
          items: input.items.map((item) => ({
            ...item,
            productId: oid(item.productId),
            modifiers: item.modifiers.map((m) => ({ ...m, groupId: oid(m.groupId), optionId: oid(m.optionId) })),
          })),
          status: "pending",
          statusHistory: [{ status: "pending", at: new Date(), byUserId: null, byName: null, reason: null }],
        },
      ],
      { session },
    );
    return toRecord(doc!.toObject());
  }

  async findByClientOrderId(restaurantId: string, clientOrderId: string): Promise<OrderRecord | null> {
    const doc = await this.orders.findOne({ restaurantId: oid(restaurantId), clientOrderId }).lean();
    return doc ? toRecord(doc) : null;
  }

  async findOne(restaurantId: string, orderId: string): Promise<OrderRecord | null> {
    if (!Types.ObjectId.isValid(orderId)) return null;
    const doc = await this.orders.findOne({ _id: oid(orderId), restaurantId: oid(restaurantId) }).lean();
    return doc ? toRecord(doc) : null;
  }

  async findByAccessTokenHash(accessTokenHash: string): Promise<OrderRecord | null> {
    const doc = await this.orders.findOne({ accessTokenHash }).lean();
    return doc ? toRecord(doc) : null;
  }

  /** Pickup/delivery orders of one phone that are still in progress (per-phone limit against fake orders). */
  async countActiveByPhone(restaurantId: string, customerPhone: string): Promise<number> {
    return this.orders.countDocuments({
      restaurantId: oid(restaurantId),
      customerPhone,
      channel: { $in: ["pickup", "delivery"] },
      status: { $nin: [...FINAL_ORDER_STATUSES] },
    });
  }

  /** Orders still in progress, oldest first (the kitchen board). */
  async listActive(restaurantId: string): Promise<OrderRecord[]> {
    const docs = await this.orders
      .find({ restaurantId: oid(restaurantId), status: { $nin: [...FINAL_ORDER_STATUSES] } })
      .sort({ createdAt: 1 })
      .lean();
    return docs.map(toRecord);
  }

  /** Every order of a business day, newest first. */
  async listByBusinessDate(restaurantId: string, businessDate: string): Promise<OrderRecord[]> {
    const docs = await this.orders
      .find({ restaurantId: oid(restaurantId), businessDate })
      .sort({ createdAt: -1 })
      .lean();
    return docs.map(toRecord);
  }

  /**
   * Moves the order to `to` only if it is still in `from`: two staff members pressing buttons at the same
   * time cannot both apply a transition from the same state.
   * @returns The updated order, or null if its status changed in between.
   */
  async transition(
    restaurantId: string,
    orderId: string,
    from: OrderStatus,
    change: {
      to: OrderStatus;
      byUserId: string | null;
      byName: string | null;
      reason: string | null;
      /** Pickup acceptance. */
      estimatedReadyAt?: Date;
    },
  ): Promise<OrderRecord | null> {
    if (!Types.ObjectId.isValid(orderId)) return null;
    const doc = await this.orders
      .findOneAndUpdate(
        { _id: oid(orderId), restaurantId: oid(restaurantId), status: from },
        {
          $set: {
            status: change.to,
            ...(change.estimatedReadyAt ? { estimatedReadyAt: change.estimatedReadyAt } : {}),
          },
          $push: {
            statusHistory: {
              status: change.to,
              at: new Date(),
              byUserId: change.byUserId ? oid(change.byUserId) : null,
              byName: change.byName,
              reason: change.reason,
            },
          },
        },
        { returnDocument: "after" },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  async markPaid(restaurantId: string, orderId: string, method: PaymentMethod): Promise<OrderRecord | null> {
    if (!Types.ObjectId.isValid(orderId)) return null;
    const doc = await this.orders
      .findOneAndUpdate(
        { _id: oid(orderId), restaurantId: oid(restaurantId) },
        { $set: { paymentStatus: "paid", paymentMethod: method } },
        { returnDocument: "after" },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }
}

type OrderDoc = Order & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };

function toRecord(doc: OrderDoc): OrderRecord {
  return {
    id: doc._id.toString(),
    restaurantId: doc.restaurantId.toString(),
    number: doc.number,
    ticketNumber: doc.ticketNumber,
    businessDate: doc.businessDate,
    channel: doc.channel,
    status: doc.status,
    statusHistory: doc.statusHistory.map((change) => ({
      status: change.status,
      at: change.at,
      byUserId: change.byUserId ? change.byUserId.toString() : null,
      byName: change.byName ?? null,
      reason: change.reason ?? null,
    })),
    paymentStatus: doc.paymentStatus,
    paymentMethod: doc.paymentMethod ?? null,
    items: doc.items.map((item) => ({
      productId: item.productId.toString(),
      name: item.name,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      note: item.note ?? "",
      lineTotal: item.lineTotal,
      modifiers: item.modifiers.map((m) => ({
        groupId: m.groupId.toString(),
        groupName: m.groupName,
        optionId: m.optionId.toString(),
        optionName: m.optionName,
        priceDelta: m.priceDelta,
      })),
    })),
    subtotal: doc.subtotal,
    total: doc.total,
    currency: doc.currency,
    customerName: doc.customerName ?? "",
    customerPhone: doc.customerPhone ?? "",
    customerEmail: doc.customerEmail ?? "",
    note: doc.note ?? "",
    tableId: doc.tableId ? doc.tableId.toString() : null,
    tableLabel: doc.tableLabel ?? null,
    estimatedReadyAt: doc.estimatedReadyAt ?? null,
    clientOrderId: doc.clientOrderId,
    createdAt: doc.createdAt ?? doc._id.getTimestamp(),
    updatedAt: doc.updatedAt ?? doc._id.getTimestamp(),
  };
}
