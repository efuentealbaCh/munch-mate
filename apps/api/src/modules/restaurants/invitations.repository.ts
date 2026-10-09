import type { RestaurantRole } from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type ClientSession, type Model, Types } from "mongoose";
import { Invitation } from "./schemas/invitation.schema";

export interface InvitationRecord {
  id: string;
  restaurantId: string;
  email: string;
  roles: RestaurantRole[];
  invitedBy: string;
  expiresAt: Date;
}

const oid = (id: string) => new Types.ObjectId(id);
/** Filter for invitations that can still be accepted. */
const pending = () => ({ acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } });

/** Tenant-scoped, except the token lookups used by the invitee (who is not a member yet). */
@Injectable()
export class InvitationsRepository {
  constructor(@InjectModel(Invitation.name) private readonly invitations: Model<Invitation>) {}

  async create(
    restaurantId: string,
    input: { email: string; roles: RestaurantRole[]; tokenHash: string; invitedBy: string; expiresAt: Date },
  ): Promise<InvitationRecord> {
    const doc = await this.invitations.create({
      ...input,
      restaurantId: oid(restaurantId),
      invitedBy: oid(input.invitedBy),
    });
    return toRecord(doc.toObject());
  }

  async listPending(restaurantId: string): Promise<InvitationRecord[]> {
    const docs = await this.invitations
      .find({ restaurantId: oid(restaurantId), ...pending() })
      .sort({ createdAt: -1 })
      .lean();
    return docs.map(toRecord);
  }

  /** Revokes earlier pending invitations to the same address, so only the newest link works. */
  async revokePendingForEmail(restaurantId: string, email: string): Promise<void> {
    await this.invitations.updateMany(
      { restaurantId: oid(restaurantId), email, ...pending() },
      { $set: { revokedAt: new Date() } },
    );
  }

  /** @returns false if no pending invitation with that id exists in this restaurant. */
  async revoke(restaurantId: string, invitationId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(invitationId)) return false;
    const result = await this.invitations.updateOne(
      { _id: oid(invitationId), restaurantId: oid(restaurantId), ...pending() },
      { $set: { revokedAt: new Date() } },
    );
    return result.modifiedCount === 1;
  }

  async findPendingByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    const doc = await this.invitations.findOne({ tokenHash, ...pending() }).lean();
    return doc ? toRecord(doc) : null;
  }

  /** Marks a pending invitation as accepted, atomically. @returns false if it was no longer pending. */
  async markAccepted(invitationId: string, userId: string, session?: ClientSession): Promise<boolean> {
    const result = await this.invitations.updateOne(
      { _id: oid(invitationId), ...pending() },
      { $set: { acceptedAt: new Date(), acceptedBy: oid(userId) } },
      { session },
    );
    return result.modifiedCount === 1;
  }
}

function toRecord(doc: Invitation & { _id: Types.ObjectId }): InvitationRecord {
  return {
    id: doc._id.toString(),
    restaurantId: doc.restaurantId.toString(),
    email: doc.email,
    roles: doc.roles,
    invitedBy: doc.invitedBy.toString(),
    expiresAt: doc.expiresAt,
  };
}
