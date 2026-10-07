import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

/**
 * Atomic sequences. `_id` names the sequence: `order:<restaurantId>` (global order number) and
 * `ticket:<restaurantId>:<YYYY-MM-DD>` (daily ticket number).
 */
@Schema({ collection: "counters", versionKey: false })
export class Counter {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ required: true, default: 0 })
  seq!: number;
}

export type CounterDocument = HydratedDocument<Counter>;
export const CounterSchema = SchemaFactory.createForClass(Counter);
