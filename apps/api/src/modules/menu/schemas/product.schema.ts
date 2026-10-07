import { MENU_LIMITS } from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

@Schema({ collection: "products", timestamps: true })
export class Product {
  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  categoryId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: MENU_LIMITS.nameMax })
  name!: string;

  @Prop({ default: "", trim: true, maxlength: MENU_LIMITS.descriptionMax })
  description!: string;

  /** Integer in the currency's minor unit (CLP: pesos). Orders copy it at purchase time. */
  @Prop({ required: true, min: 0, max: MENU_LIMITS.priceMax })
  price!: number;

  /** "Agotado" when false: listed but not orderable. */
  @Prop({ default: true })
  available!: boolean;

  /** Hidden from the public menu when false. */
  @Prop({ default: true })
  visible!: boolean;

  /** Base key of the photo in the media bucket (variants `<key>-<size>.webp`). */
  @Prop({ type: String, default: null })
  imageKey!: string | null;

  /** Reusable modifier groups, in display order. */
  @Prop({ type: [Types.ObjectId], default: [] })
  modifierGroupIds!: Types.ObjectId[];

  /** Display order within its category. */
  @Prop({ required: true })
  position!: number;
}

export type ProductDocument = HydratedDocument<Product>;
export const ProductSchema = SchemaFactory.createForClass(Product);
ProductSchema.index({ restaurantId: 1, categoryId: 1, position: 1 });
// Finds the products using a modifier group (usage counts, removal on group deletion).
ProductSchema.index({ restaurantId: 1, modifierGroupIds: 1 });
