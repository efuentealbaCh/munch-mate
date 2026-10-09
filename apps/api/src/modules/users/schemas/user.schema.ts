import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import type { HydratedDocument } from "mongoose";

export const PLATFORM_ROLES = ["admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/** Platform-level account. Restaurant roles live in memberships, not here. */
@Schema({ collection: "users", timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({ type: Date, default: null })
  emailVerifiedAt!: Date | null;

  @Prop({ type: String, enum: PLATFORM_ROLES, default: null })
  platformRole!: PlatformRole | null;

  /** Normalized (+56912345678); prefills checkouts. "" when not set. */
  @Prop({ default: "" })
  phone!: string;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
