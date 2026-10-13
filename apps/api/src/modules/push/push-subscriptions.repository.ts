import type { PushSubscriptionInput } from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { PushSubscription } from "./schemas/push-subscription.schema";

export type PushTarget = PushSubscriptionInput;

const oid = (id: string) => new Types.ObjectId(id);

/**
 * Not tenant-scoped: subscriptions belong to a user or to one order. Who may be notified is decided by the
 * callers (memberships, the order's own followers).
 */
@Injectable()
export class PushSubscriptionsRepository {
  constructor(@InjectModel(PushSubscription.name) private readonly subscriptions: Model<PushSubscription>) {}

  /** A user's device. The same browser re-subscribing (or another account on it) takes the endpoint over. */
  async saveForUser(userId: string, subscription: PushSubscriptionInput): Promise<void> {
    await this.subscriptions.updateOne(
      { endpoint: subscription.endpoint },
      { $set: { keys: subscription.keys, userId: oid(userId), orderId: null, expiresAt: null } },
      { upsert: true },
    );
  }

  /** A browser following one order (guest or not), until `expiresAt`. */
  async saveForOrder(orderId: string, subscription: PushSubscriptionInput, expiresAt: Date): Promise<void> {
    // A user device keeps its owner: following an order from it must not detach it from the account.
    await this.subscriptions.updateOne(
      { endpoint: subscription.endpoint, userId: null },
      { $set: { keys: subscription.keys, orderId: oid(orderId), expiresAt } },
      { upsert: true },
    ).catch(async (error: { code?: number }) => {
      // Duplicate endpoint: it is a user device. Leave it alone; the user already gets their notifications.
      if (error.code !== 11000) throw error;
    });
  }

  /** Unsubscribes one of the user's devices. */
  async deleteForUser(userId: string, endpoint: string): Promise<void> {
    await this.subscriptions.deleteOne({ endpoint, userId: oid(userId) });
  }

  async listForUsers(userIds: string[]): Promise<PushTarget[]> {
    if (userIds.length === 0) return [];
    const docs = await this.subscriptions.find({ userId: { $in: userIds.map(oid) } }).lean();
    return docs.map((doc) => ({ endpoint: doc.endpoint, keys: { p256dh: doc.keys.p256dh, auth: doc.keys.auth } }));
  }

  async listForOrder(orderId: string): Promise<PushTarget[]> {
    const docs = await this.subscriptions.find({ orderId: oid(orderId), expiresAt: { $gt: new Date() } }).lean();
    return docs.map((doc) => ({ endpoint: doc.endpoint, keys: { p256dh: doc.keys.p256dh, auth: doc.keys.auth } }));
  }
}
