import { PAYMENT_METHODS, type PaymentMethod, TABLE_PAYMENT_KINDS, type TablePaymentKind } from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/** How the staff split the account (a display plan: payments of another kind stay valid). */
@Schema({ _id: false })
export class TableSplitPlan {
  @Prop({ type: String, enum: ["equal", "items", "amounts"], required: true })
  mode!: "equal" | "items" | "amounts";

  /** Equal split only: 2..SPLIT_LIMITS.partsMax. */
  @Prop({ type: Number, default: null })
  parts!: number | null;
}

/** A line paid by a "pay by products" payment: index in the order's items (orders with payments cannot be edited). */
@Schema({ _id: false })
export class TablePaymentLine {
  @Prop({ type: Types.ObjectId, required: true })
  orderId!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  line!: number;

  @Prop({ required: true, min: 1 })
  quantity!: number;
}

/** A partial payment of the account. `amount` is computed by the server and excludes the tip. */
@Schema()
export class TablePayment {
  _id!: Types.ObjectId;

  @Prop({ type: String, enum: TABLE_PAYMENT_KINDS, required: true })
  kind!: TablePaymentKind;

  @Prop({ required: true, min: 1 })
  amount!: number;

  @Prop({ required: true, min: 0 })
  tip!: number;

  @Prop({ type: String, enum: PAYMENT_METHODS, required: true })
  method!: PaymentMethod;

  /** Equal parts: which one (1-based). */
  @Prop({ type: Number, default: null })
  part!: number | null;

  @Prop({ type: [SchemaFactory.createForClass(TablePaymentLine)], default: [] })
  items!: TablePaymentLine[];

  @Prop({ required: true })
  at!: Date;

  @Prop({ type: Types.ObjectId, required: true })
  byUserId!: Types.ObjectId;

  /** Name snapshot, so the account stays readable if the member leaves. */
  @Prop({ type: String, default: null })
  byName!: string | null;
}

/**
 * A table account (phase 8): the dine-in orders of one table add up here until the staff charge it. It opens
 * with the first order (or the first call to the waiter) and closes when paid; the next order opens a new one.
 */
@Schema({ collection: "table_sessions", timestamps: true })
export class TableSession {
  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  tableId!: Types.ObjectId;

  /** Snapshot: renaming the table later does not change past accounts. */
  @Prop({ required: true })
  tableLabel!: string;

  @Prop({ type: String, enum: ["open", "closed"], default: "open" })
  status!: "open" | "closed";

  @Prop({ required: true })
  openedAt!: Date;

  /** Someone at the table pressed "Llamar al garzón"; cleared when a waiter attends. */
  @Prop({ type: Date, default: null })
  waiterCalledAt!: Date | null;

  /** Someone asked for the bill; cleared when it is paid. */
  @Prop({ type: Date, default: null })
  billRequestedAt!: Date | null;

  /** The tip the customer chose when asking for the bill (amount). */
  @Prop({ type: Number, default: null })
  requestedTip!: number | null;

  @Prop({ type: Date, default: null })
  closedAt!: Date | null;

  /** Business day of the closing (restaurant timezone): tips are reported on that day. */
  @Prop({ type: String, default: null })
  closedBusinessDate!: string | null;

  /** What was charged when closing: the tips of the payments (for the waiters, not part of sales). */
  @Prop({ type: Number, default: null })
  tip!: number | null;

  /** The method of every payment, or null when they used several (then see `paymentMethods`). */
  @Prop({ type: String, enum: [...PAYMENT_METHODS, null], default: null })
  paymentMethod!: PaymentMethod | null;

  /** Different methods used by the payments (accounts closed before split bills lack it: see `paymentMethod`). */
  @Prop({ type: [String], enum: PAYMENT_METHODS, default: [] })
  paymentMethods!: PaymentMethod[];

  /** How the staff split the account; null = not split (older accounts lack it). */
  @Prop({ type: SchemaFactory.createForClass(TableSplitPlan), default: null })
  split!: TableSplitPlan | null;

  /** Partial payments, oldest first (older accounts lack it = none). Closing adds the last one. */
  @Prop({ type: [SchemaFactory.createForClass(TablePayment)], default: [] })
  payments!: TablePayment[];

  /**
   * Bumped by every write that changes what a payment is computed against (payments, the plan, item edits and
   * single payments of its orders): a payment is only recorded on the revision it was computed on, so two
   * waiters charging at once cannot exceed the bill or pay the same part twice. Missing on older accounts = 0.
   */
  @Prop({ default: 0 })
  revision!: number;

  @Prop({ type: Types.ObjectId, default: null })
  closedBy!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  closedByName!: string | null;
}

export type TableSessionDocument = HydratedDocument<TableSession>;
export const TableSessionSchema = SchemaFactory.createForClass(TableSession);
// At most one open account per table: concurrent first orders of a table share it (the loser retries).
TableSessionSchema.index(
  { restaurantId: 1, tableId: 1 },
  { unique: true, partialFilterExpression: { status: "open" }, name: "one_open_account_per_table" },
);
TableSessionSchema.index({ restaurantId: 1, status: 1, openedAt: 1 });
TableSessionSchema.index({ restaurantId: 1, tableId: 1, closedAt: -1 });
TableSessionSchema.index({ restaurantId: 1, closedBusinessDate: 1 });
