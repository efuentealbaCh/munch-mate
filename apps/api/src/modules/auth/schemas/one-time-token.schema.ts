import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

export const ONE_TIME_TOKEN_TYPES = ["verify_email", "password_reset"] as const;
export type OneTimeTokenType = (typeof ONE_TIME_TOKEN_TYPES)[number];

/** Single-use token sent by email (verification, password reset). Only its hash is stored. */
@Schema({ collection: "one_time_tokens", timestamps: { createdAt: true, updatedAt: false } })
export class OneTimeToken {
  @Prop({ type: String, enum: ONE_TIME_TOKEN_TYPES, required: true })
  type!: OneTimeTokenType;

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  usedAt!: Date | null;
}

export type OneTimeTokenDocument = HydratedDocument<OneTimeToken>;
export const OneTimeTokenSchema = SchemaFactory.createForClass(OneTimeToken);
OneTimeTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
