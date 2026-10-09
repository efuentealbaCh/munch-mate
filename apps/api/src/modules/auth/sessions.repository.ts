import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { Session } from "./schemas/session.schema";

export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

@Injectable()
export class SessionsRepository {
  constructor(@InjectModel(Session.name) private readonly sessions: Model<Session>) {}

  async create(input: {
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  }): Promise<SessionRecord> {
    const doc = await this.sessions.create({ ...input, userId: new Types.ObjectId(input.userId) });
    return toRecord(doc.toObject());
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const doc = await this.sessions.findOne({ tokenHash }).lean();
    return doc ? toRecord(doc) : null;
  }

  /**
   * Marks a session as rotated, atomically: only one of several concurrent refreshes with the same
   * token can win. @returns false if it was already rotated or revoked.
   */
  async markRotated(id: string): Promise<boolean> {
    const result = await this.sessions.updateOne(
      { _id: id, rotatedAt: null, revokedAt: null },
      { $set: { rotatedAt: new Date() } },
    );
    return result.modifiedCount === 1;
  }

  /** Revokes every session of one login (used on logout and on refresh-token reuse). */
  async revokeFamily(familyId: string): Promise<void> {
    await this.sessions.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }

  /** Revokes every session of a user on every device (used after a password reset). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.sessions.updateMany(
      { userId: new Types.ObjectId(userId), revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }
}

function toRecord(doc: Session & { _id: Types.ObjectId }): SessionRecord {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    familyId: doc.familyId,
    expiresAt: doc.expiresAt,
    rotatedAt: doc.rotatedAt ?? null,
    revokedAt: doc.revokedAt ?? null,
  };
}
