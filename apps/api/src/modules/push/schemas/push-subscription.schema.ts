import { Prop, raw, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/**
 * A browser that accepted notifications. Two kinds:
 * - user devices (staff and riders, `userId`): kept until the browser unsubscribes or the push service
 *   reports the endpoint gone;
 * - order followers (`orderId`, guests included): expire on their own (`expiresAt`, TTL index).
 * The workers read and delete these by endpoint (see apps/workers/src/notif).
 */
@Schema({ collection: "push_subscriptions", timestamps: true })
export class PushSubscription {
  @Prop({ required: true, unique: true })
  endpoint!: string;

  @Prop(raw({ p256dh: { type: String, required: true }, auth: { type: String, required: true } }))
  keys!: { p256dh: string; auth: string };

  @Prop({ type: Types.ObjectId, default: null, index: true })
  userId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, default: null, index: true })
  orderId!: Types.ObjectId | null;

  /** Order followers only. */
  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;
}

export type PushSubscriptionDocument = HydratedDocument<PushSubscription>;
export const PushSubscriptionSchema = SchemaFactory.createForClass(PushSubscription);
// Removes order followers once their order is surely over; documents without expiresAt never expire.
PushSubscriptionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
