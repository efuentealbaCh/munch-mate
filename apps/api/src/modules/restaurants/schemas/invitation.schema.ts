import { RESTAURANT_ROLES, type RestaurantRole } from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/** Staff invitation bound to an email address. Single use; only the token hash is stored. */
@Schema({ collection: "invitations", timestamps: { createdAt: true, updatedAt: false } })
export class Invitation {
  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ type: [String], enum: RESTAURANT_ROLES, required: true })
  roles!: RestaurantRole[];

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ type: Types.ObjectId, required: true })
  invitedBy!: Types.ObjectId;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  acceptedAt!: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  acceptedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;
}

export type InvitationDocument = HydratedDocument<Invitation>;
export const InvitationSchema = SchemaFactory.createForClass(Invitation);
InvitationSchema.index({ restaurantId: 1, email: 1 });
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
