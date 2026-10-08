import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/** A commune or sector the restaurant delivers to. Amounts in the restaurant currency's minor unit. */
@Schema({ collection: "delivery_zones", timestamps: true })
export class DeliveryZone {
  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, min: 0 })
  fee!: number;

  /** Minimum subtotal (before the fee) to deliver to this zone; 0 = none. */
  @Prop({ required: true, min: 0, default: 0 })
  minOrder!: number;

  @Prop({ default: true })
  active!: boolean;

  /** The restaurant's own commune, preselected at checkout. The service keeps at most one per restaurant. */
  @Prop({ default: false })
  isHome!: boolean;

  @Prop({ required: true, default: 0 })
  position!: number;
}

export type DeliveryZoneDocument = HydratedDocument<DeliveryZone>;
export const DeliveryZoneSchema = SchemaFactory.createForClass(DeliveryZone);
DeliveryZoneSchema.index({ restaurantId: 1, position: 1 });
