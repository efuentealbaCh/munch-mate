import { MENU_LIMITS } from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

@Schema({ collection: "menu_categories", timestamps: true })
export class MenuCategory {
  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: MENU_LIMITS.nameMax })
  name!: string;

  @Prop({ default: "", trim: true, maxlength: MENU_LIMITS.descriptionMax })
  description!: string;

  /** Display order within the restaurant (0-based, rewritten on reorder). */
  @Prop({ required: true })
  position!: number;

  /** false hides the category (and its products) from the public menu. */
  @Prop({ default: true })
  active!: boolean;
}

export type MenuCategoryDocument = HydratedDocument<MenuCategory>;
export const MenuCategorySchema = SchemaFactory.createForClass(MenuCategory);
MenuCategorySchema.index({ restaurantId: 1, position: 1 });
