import { TABLE_ROTATIONS, TABLE_SEATS, TABLE_SHAPES, type TableRotation, type TableSeats, type TableShape } from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/** Where a table sits on the floor plan (phase 9); see `tableFootprint` in @app/utils for the cells it takes. */
@Schema({ _id: false })
export class TableLayoutDoc {
  @Prop({ required: true, min: 0 })
  x!: number;

  @Prop({ required: true, min: 0 })
  y!: number;

  @Prop({ type: String, enum: TABLE_SHAPES, required: true })
  shape!: TableShape;

  @Prop({ type: Number, enum: TABLE_SEATS, required: true })
  seats!: TableSeats;

  /** 0 = horizontal, 90 = vertical. Missing in layouts saved before it existed: read as 0. */
  @Prop({ type: Number, enum: TABLE_ROTATIONS, default: 0 })
  rotation!: TableRotation;
}
const TableLayoutSchema = SchemaFactory.createForClass(TableLayoutDoc);

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

  /**
   * Position on the restaurant's floor plan (phase 9). null (or missing in older documents) = not placed.
   * Kept when the table is deactivated (the live view skips inactive tables), gone with the table when deleted.
   */
  @Prop({ type: TableLayoutSchema, default: null })
  layout!: TableLayoutDoc | null;
}

export type TableDocument = HydratedDocument<Table>;
export const TableSchema = SchemaFactory.createForClass(Table);
TableSchema.index({ restaurantId: 1, label: 1 });
