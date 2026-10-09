import { MENU_LIMITS } from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

@Schema()
export class ModifierOption {
  _id!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: MENU_LIMITS.nameMax })
  name!: string;

  /** Added to the product price when chosen. Never negative: discounts are not modifiers. */
  @Prop({ required: true, min: 0, max: MENU_LIMITS.priceMax })
  priceDelta!: number;

  @Prop({ default: true })
  available!: boolean;
}
const ModifierOptionSchema = SchemaFactory.createForClass(ModifierOption);

/**
 * Reusable set of options ("Tamaño", "Agregados") shared by many products: editing the group updates
 * every product that uses it. Orders store a snapshot, so later edits never change past orders.
 */
@Schema({ collection: "modifier_groups", timestamps: true })
export class ModifierGroup {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  restaurantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: MENU_LIMITS.nameMax })
  name!: string;

  /** 0 = optional; ≥ 1 = the customer must choose at least this many. */
  @Prop({ required: true, min: 0 })
  minSelect!: number;

  /** 1 = single choice (radio); > 1 = multiple (checkboxes). */
  @Prop({ required: true, min: 1 })
  maxSelect!: number;

  @Prop({ type: [ModifierOptionSchema], default: [] })
  options!: ModifierOption[];
}

export type ModifierGroupDocument = HydratedDocument<ModifierGroup>;
export const ModifierGroupSchema = SchemaFactory.createForClass(ModifierGroup);
