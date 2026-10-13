import {
  FINAL_ORDER_STATUSES,
  type GeoPoint,
  type MessageChannel,
  type OrderChannel,
  type OrderStatus,
  type PaymentMethod,
} from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type ClientSession, type Model, Types } from "mongoose";
import type { PricedItem } from "./order-pricing";
import { Order } from "./schemas/order.schema";

export interface DeliveryRecord {
  zoneId: string;
  zoneName: string;
  address: string;
  unit: string;
  reference: string;
  location: GeoPoint | null;
}

export interface ExpectedPaymentRecord {
  method: PaymentMethod;
  cashAmount: number | null;
}

export interface StatusChangeRecord {
  status: OrderStatus;
  at: Date;
  byUserId: string | null;
  byName: string | null;
  reason: string | null;
}

export interface OrderEditRecord {
  at: Date;
  byUserId: string;
  byName: string | null;
  reason: string | null;
  changes: string[];
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
  deliveryFee: number;
  total: number;
  currency: string;
  /** 0 until the staff edit the items; each edit bumps it. */
  revision: number;
  edits: OrderEditRecord[];
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  note: string;
  tableId: string | null;
  tableLabel: string | null;
  tableSessionId: string | null;
  notifyBy: MessageChannel | null;
  estimatedReadyAt: Date | null;
  delivery: DeliveryRecord | null;
  expectedPayment: ExpectedPaymentRecord | null;
  riderId: string | null;
  riderName: string | null;
  customerId: string | null;
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
  deliveryFee: number;
  total: number;
  currency: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  note: string;
  tableId: string | null;
  tableLabel: string | null;
  tableSessionId: string | null;
  notifyBy: MessageChannel | null;
  delivery: DeliveryRecord | null;
  expectedPayment: ExpectedPaymentRecord | null;
  customerId: string | null;
  accessTokenHash: string;
  clientOrderId: string;
}

const oid = (id: string) => new Types.ObjectId(id);
export const DUPLICATE_KEY = 11000;

/** Priced lines as stored (ids as ObjectIds). */
const toItemDocs = (items: PricedItem[]) =>
  items.map((item) => ({
    ...item,
    productId: oid(item.productId),
    modifiers: item.modifiers.map((m) => ({ ...m, groupId: oid(m.groupId), optionId: oid(m.optionId) })),
  }));

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
          tableSessionId: input.tableSessionId ? oid(input.tableSessionId) : null,
          customerId: input.customerId ? oid(input.customerId) : null,
          delivery: input.delivery
            ? {
                ...input.delivery,
                zoneId: oid(input.delivery.zoneId),
                location: input.delivery.location ?? undefined,
              }
            : null,
          items: toItemDocs(input.items),
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

  /** Deliveries in progress assigned to one rider, oldest first (the rider's screen). */
  async listActiveForRider(restaurantId: string, riderId: string): Promise<OrderRecord[]> {
    const docs = await this.orders
      .find({
        restaurantId: oid(restaurantId),
        channel: "delivery",
        riderId: oid(riderId),
        status: { $nin: [...FINAL_ORDER_STATUSES] },
      })
      .sort({ createdAt: 1 })
      .lean();
    return docs.map(toRecord);
  }

  /**
   * Assigns (or with null, unassigns) the rider of a delivery that is not finished yet.
   * @returns The updated order, or null if it does not exist, is not a delivery or is already finished.
   */
  async assignRider(
    restaurantId: string,
    orderId: string,
    rider: { id: string; name: string } | null,
  ): Promise<OrderRecord | null> {
    if (!Types.ObjectId.isValid(orderId)) return null;
    const doc = await this.orders
      .findOneAndUpdate(
        {
          _id: oid(orderId),
          restaurantId: oid(restaurantId),
          channel: "delivery",
          status: { $nin: [...FINAL_ORDER_STATUSES] },
        },
        { $set: { riderId: rider ? oid(rider.id) : null, riderName: rider?.name ?? null } },
        { returnDocument: "after" },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  /**
   * A customer's orders across restaurants, newest first: the only cross-tenant listing, scoped by the
   * customer instead (like memberships by user).
   * @param before Only orders after this one in the listing (createdAt, then id: two orders created in the
   *   same millisecond are neither skipped nor repeated across pages).
   */
  async listByCustomer(
    customerId: string,
    before: { createdAt: Date; id: string } | null,
    limit: number,
  ): Promise<OrderRecord[]> {
    if (!Types.ObjectId.isValid(customerId)) return [];
    const page = before
      ? {
          $or: [
            { createdAt: { $lt: before.createdAt } },
            { createdAt: before.createdAt, _id: { $lt: oid(before.id) } },
          ],
        }
      : {};
    const docs = await this.orders
      .find({ customerId: oid(customerId), ...page })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    return docs.map(toRecord);
  }

  /** Any restaurant's order by id: only for checks that verify the caller's rights themselves (rider reports). */
  async findById(orderId: string): Promise<OrderRecord | null> {
    if (!Types.ObjectId.isValid(orderId)) return null;
    const doc = await this.orders.findById(orderId).lean();
    return doc ? toRecord(doc) : null;
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

  /**
   * Replaces the items of an order the staff edited, only if nothing happened to it since it was read: same
   * status, same revision and still unpaid. Two staff members editing at once, or someone pressing "Empezar"
   * or registering the payment meanwhile, make the second write miss instead of overwriting.
   * @param clearCashAmount The new total exceeds the bill the customer said they would pay with.
   * @returns The updated order, or null when it changed in between (or does not exist).
   */
  async editItems(
    restaurantId: string,
    orderId: string,
    expected: { status: OrderStatus; revision: number },
    change: {
      items: PricedItem[];
      subtotal: number;
      total: number;
      clearCashAmount: boolean;
      edit: OrderEditRecord;
    },
  ): Promise<OrderRecord | null> {
    if (!Types.ObjectId.isValid(orderId)) return null;
    const doc = await this.orders
      .findOneAndUpdate(
        {
          _id: oid(orderId),
          restaurantId: oid(restaurantId),
          status: expected.status,
          // Orders older than item edits have no revision field: it reads as 0.
          revision: expected.revision === 0 ? { $in: [0, null] } : expected.revision,
          paymentStatus: "unpaid",
        },
        {
          $set: {
            items: toItemDocs(change.items),
            subtotal: change.subtotal,
            total: change.total,
            ...(change.clearCashAmount ? { "expectedPayment.cashAmount": null } : {}),
          },
          $inc: { revision: 1 },
          $push: { edits: { ...change.edit, byUserId: oid(change.edit.byUserId) } },
        },
        { returnDocument: "after" },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  /** The orders of a table account, oldest first. */
  async listByTableSession(restaurantId: string, tableSessionId: string): Promise<OrderRecord[]> {
    if (!Types.ObjectId.isValid(tableSessionId)) return [];
    const docs = await this.orders
      .find({ restaurantId: oid(restaurantId), tableSessionId: oid(tableSessionId) })
      .sort({ createdAt: 1 })
      .lean();
    return docs.map(toRecord);
  }

  /** The orders of several table accounts (the floor view), grouped by account id. */
  async listByTableSessions(restaurantId: string, tableSessionIds: string[]): Promise<Map<string, OrderRecord[]>> {
    const byId = new Map<string, OrderRecord[]>(tableSessionIds.map((id) => [id, []]));
    if (tableSessionIds.length === 0) return byId;
    const docs = await this.orders
      .find({ restaurantId: oid(restaurantId), tableSessionId: { $in: tableSessionIds.map(oid) } })
      .sort({ createdAt: 1 })
      .lean();
    for (const record of docs.map(toRecord)) byId.get(record.tableSessionId!)?.push(record);
    return byId;
  }

  /** Every order of the business days from..to (inclusive), oldest first (reports and exports). */
  async listByBusinessDateRange(restaurantId: string, from: string, to: string): Promise<OrderRecord[]> {
    const docs = await this.orders
      .find({ restaurantId: oid(restaurantId), businessDate: { $gte: from, $lte: to } })
      .sort({ createdAt: 1 })
      .lean();
    return docs.map(toRecord);
  }

  /** Charging a table account pays every unpaid order of it (rejected and cancelled ones excepted). */
  async payTableSession(
    restaurantId: string,
    tableSessionId: string,
    method: PaymentMethod,
    session?: ClientSession,
  ): Promise<void> {
    await this.orders.updateMany(
      {
        restaurantId: oid(restaurantId),
        tableSessionId: oid(tableSessionId),
        paymentStatus: "unpaid",
        status: { $nin: ["rejected", "cancelled"] },
      },
      { $set: { paymentStatus: "paid", paymentMethod: method } },
      { session },
    );
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
      regularUnitPrice: item.regularUnitPrice ?? item.unitPrice,
      promoLabel: item.promoLabel ?? "",
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
    deliveryFee: doc.deliveryFee ?? 0,
    total: doc.total,
    currency: doc.currency,
    revision: doc.revision ?? 0,
    edits: (doc.edits ?? []).map((edit) => ({
      at: edit.at,
      byUserId: edit.byUserId.toString(),
      byName: edit.byName ?? null,
      reason: edit.reason ?? null,
      changes: [...(edit.changes ?? [])],
    })),
    customerName: doc.customerName ?? "",
    customerPhone: doc.customerPhone ?? "",
    customerEmail: doc.customerEmail ?? "",
    note: doc.note ?? "",
    tableId: doc.tableId ? doc.tableId.toString() : null,
    tableLabel: doc.tableLabel ?? null,
    tableSessionId: doc.tableSessionId ? doc.tableSessionId.toString() : null,
    notifyBy: doc.notifyBy ?? null,
    estimatedReadyAt: doc.estimatedReadyAt ?? null,
    delivery: doc.delivery
      ? {
          zoneId: doc.delivery.zoneId.toString(),
          zoneName: doc.delivery.zoneName,
          address: doc.delivery.address,
          unit: doc.delivery.unit ?? "",
          reference: doc.delivery.reference ?? "",
          location:
            typeof doc.delivery.location?.lat === "number" && typeof doc.delivery.location.lng === "number"
              ? { lat: doc.delivery.location.lat, lng: doc.delivery.location.lng }
              : null,
        }
      : null,
    expectedPayment: doc.expectedPayment
      ? { method: doc.expectedPayment.method, cashAmount: doc.expectedPayment.cashAmount ?? null }
      : null,
    riderId: doc.riderId ? doc.riderId.toString() : null,
    riderName: doc.riderName ?? null,
    customerId: doc.customerId ? doc.customerId.toString() : null,
    clientOrderId: doc.clientOrderId,
    createdAt: doc.createdAt ?? doc._id.getTimestamp(),
    updatedAt: doc.updatedAt ?? doc._id.getTimestamp(),
  };
}
