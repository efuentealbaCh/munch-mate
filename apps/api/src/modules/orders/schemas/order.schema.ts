import {
  ORDER_CHANNELS,
  ORDER_STATUSES,
  type OrderChannel,
  type OrderStatus,
  PAYMENT_METHODS,
  type PaymentMethod,
  type PaymentStatus,
} from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

@Schema({ _id: false })
export class OrderItemModifierSnapshot {
  @Prop({ type: Types.ObjectId, required: true })
  groupId!: Types.ObjectId;

  @Prop({ required: true })
  groupName!: string;

  @Prop({ type: Types.ObjectId, required: true })
  optionId!: Types.ObjectId;

  @Prop({ required: true })
  optionName!: string;

  @Prop({ required: true })
  priceDelta!: number;
}

/** Price snapshot of a line at purchase time; later menu edits never change it. */
@Schema({ _id: false })
export class OrderItemSnapshot {
  @Prop({ type: Types.ObjectId, required: true })
  productId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  unitPrice!: number;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({ type: [SchemaFactory.createForClass(OrderItemModifierSnapshot)], default: [] })
  modifiers!: OrderItemModifierSnapshot[];

  @Prop({ default: "" })
  note!: string;

  @Prop({ required: true })
  lineTotal!: number;
}

@Schema({ _id: false })
export class StatusChange {
  @Prop({ type: String, enum: ORDER_STATUSES, required: true })
  status!: OrderStatus;

  @Prop({ required: true })
  at!: Date;

  /** Staff member who made the change; null for the customer or the system. */
  @Prop({ type: Types.ObjectId, default: null })
  byUserId!: Types.ObjectId | null;

  /** Name snapshot, so the history stays readable if the member leaves. */
  @Prop({ type: String, default: null })
  byName!: string | null;

  @Prop({ type: String, default: null })
  reason!: string | null;
}

@Schema({ collection: "orders", timestamps: true })
export class Order {
  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  /** Global per restaurant, never resets. */
  @Prop({ required: true })
  number!: number;

  /** Daily per restaurant (business date in the restaurant's timezone). */
  @Prop({ required: true })
  ticketNumber!: number;

  /** YYYY-MM-DD in the restaurant's timezone. */
  @Prop({ required: true })
  businessDate!: string;

  @Prop({ type: String, enum: ORDER_CHANNELS, required: true })
  channel!: OrderChannel;

  @Prop({ type: String, enum: ORDER_STATUSES, required: true })
  status!: OrderStatus;

  @Prop({ type: [SchemaFactory.createForClass(StatusChange)], default: [] })
  statusHistory!: StatusChange[];

  @Prop({ type: String, enum: ["unpaid", "paid"], default: "unpaid" })
  paymentStatus!: PaymentStatus;

  @Prop({ type: String, enum: [...PAYMENT_METHODS, null], default: null })
  paymentMethod!: PaymentMethod | null;

  @Prop({ type: [SchemaFactory.createForClass(OrderItemSnapshot)], required: true })
  items!: OrderItemSnapshot[];

  @Prop({ required: true })
  subtotal!: number;

  @Prop({ required: true })
  total!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ default: "" })
  customerName!: string;

  @Prop({ default: "" })
  note!: string;

  @Prop({ type: Types.ObjectId, default: null })
  tableId!: Types.ObjectId | null;

  /** Snapshot: renaming or deleting the table later does not change past orders. */
  @Prop({ type: String, default: null })
  tableLabel!: string | null;

  /** SHA-256 of the customer's access token (tracking link). */
  @Prop({ required: true, unique: true })
  accessTokenHash!: string;

  /** Browser-generated id: a retried submission returns the existing order instead of a duplicate. */
  @Prop({ required: true })
  clientOrderId!: string;
}

export type OrderDocument = HydratedDocument<Order>;
export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ restaurantId: 1, clientOrderId: 1 }, { unique: true });
OrderSchema.index({ restaurantId: 1, status: 1, createdAt: 1 });
OrderSchema.index({ restaurantId: 1, businessDate: 1 });
