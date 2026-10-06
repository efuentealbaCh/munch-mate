import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/**
 * One refresh token. Every refresh rotates it: the old session gets `rotatedAt` and a new one is created
 * in the same `familyId`. Presenting a rotated token again means it was stolen → the whole family is revoked.
 */
@Schema({ collection: "sessions", timestamps: { createdAt: true, updatedAt: false } })
export class Session {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  /** Shared by every rotation of one login; revoking it logs that device out. */
  @Prop({ required: true, index: true })
  familyId!: string;

  /** SHA-256 of the refresh token; the raw token only exists in the user's cookie. */
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  rotatedAt!: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: String, default: null })
  userAgent!: string | null;

  @Prop({ type: String, default: null })
  ip!: string | null;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);
// Expired sessions are deleted by MongoDB; rotated/revoked ones are kept until then for reuse detection.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
