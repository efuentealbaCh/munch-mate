import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { OneTimeToken, type OneTimeTokenType } from "./schemas/one-time-token.schema";

@Injectable()
export class OneTimeTokensRepository {
  constructor(@InjectModel(OneTimeToken.name) private readonly tokens: Model<OneTimeToken>) {}

  /** @returns The id of the stored token (used as the email job's idempotency key). */
  async create(input: { type: OneTimeTokenType; userId: string; tokenHash: string; expiresAt: Date }): Promise<string> {
    const doc = await this.tokens.create({ ...input, userId: new Types.ObjectId(input.userId) });
    return doc._id.toString();
  }

  /**
   * Atomically marks a valid token as used.
   * @returns The owner's user id, or null if the token does not exist, is expired, already used or of another type.
   */
  async consume(type: OneTimeTokenType, tokenHash: string): Promise<string | null> {
    const now = new Date();
    const doc = await this.tokens
      .findOneAndUpdate(
        { type, tokenHash, usedAt: null, expiresAt: { $gt: now } },
        { $set: { usedAt: now } },
        { returnDocument: "after" },
      )
      .lean();
    return doc ? doc.userId.toString() : null;
  }

  /** Invalidates pending tokens of a type, so only the most recently emailed link works. */
  async invalidatePending(type: OneTimeTokenType, userId: string): Promise<void> {
    await this.tokens.updateMany(
      { type, userId: new Types.ObjectId(userId), usedAt: null },
      { $set: { usedAt: new Date() } },
    );
  }
}
