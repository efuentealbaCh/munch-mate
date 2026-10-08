import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/** A dine-in table. Its QR points to `/m/<token>`, independent of the restaurant slug. */
@Schema({ collection: "tables", timestamps: true })
export class Table {
  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 30 })
  label!: string;

  /** Printed in the QR. Not a secret (it is on the table), but regenerable if a QR is copied and abused. */
  @Prop({ required: true, unique: true })
  token!: string;

  @Prop({ default: true })
  active!: boolean;
}

export type TableDocument = HydratedDocument<Table>;
export const TableSchema = SchemaFactory.createForClass(Table);
TableSchema.index({ restaurantId: 1, label: 1 });
