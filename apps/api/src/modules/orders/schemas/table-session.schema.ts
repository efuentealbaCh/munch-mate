import { PAYMENT_METHODS, type PaymentMethod } from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

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

  /** What was charged when closing: the tip (for the waiters, not part of sales) and the payment method. */
  @Prop({ type: Number, default: null })
  tip!: number | null;

  @Prop({ type: String, enum: [...PAYMENT_METHODS, null], default: null })
  paymentMethod!: PaymentMethod | null;

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
