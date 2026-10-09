import { RESTAURANT_ROLES, type RestaurantRole } from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/** A user's roles in one restaurant. Tenant-scoped by `restaurantId`. */
@Schema({ collection: "memberships", timestamps: true })
export class Membership {
  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: [String], enum: RESTAURANT_ROLES, required: true })
  roles!: RestaurantRole[];
}

export type MembershipDocument = HydratedDocument<Membership>;
export const MembershipSchema = SchemaFactory.createForClass(Membership);
// One membership per user and restaurant; also serves tenant-scoped lookups by restaurantId.
MembershipSchema.index({ restaurantId: 1, userId: 1 }, { unique: true });
