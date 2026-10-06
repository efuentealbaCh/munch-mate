import type { RestaurantRole } from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type ClientSession, type Model, Types } from "mongoose";
import { Membership } from "./schemas/membership.schema";

export interface MembershipRecord {
  restaurantId: string;
  userId: string;
  roles: RestaurantRole[];
  joinedAt: Date;
}

const oid = (id: string) => new Types.ObjectId(id);

/** Tenant-scoped: every method that targets a restaurant takes its id first and filters by it. */
@Injectable()
export class MembershipsRepository {
  constructor(@InjectModel(Membership.name) private readonly memberships: Model<Membership>) {}

  async create(
    restaurantId: string,
    userId: string,
    roles: RestaurantRole[],
    session?: ClientSession,
  ): Promise<void> {
    await this.memberships.create([{ restaurantId: oid(restaurantId), userId: oid(userId), roles }], { session });
  }

  async findOne(restaurantId: string, userId: string): Promise<MembershipRecord | null> {
    if (!Types.ObjectId.isValid(restaurantId) || !Types.ObjectId.isValid(userId)) return null;
    const doc = await this.memberships.findOne({ restaurantId: oid(restaurantId), userId: oid(userId) }).lean();
    return doc ? toRecord(doc) : null;
  }

  async listByRestaurant(restaurantId: string): Promise<MembershipRecord[]> {
    const docs = await this.memberships.find({ restaurantId: oid(restaurantId) }).sort({ createdAt: 1 }).lean();
    return docs.map(toRecord);
  }

  /** Every restaurant the user belongs to (the only cross-tenant query, scoped by the user instead). */
  async listByUser(userId: string): Promise<MembershipRecord[]> {
    const docs = await this.memberships.find({ userId: oid(userId) }).sort({ createdAt: 1 }).lean();
    return docs.map(toRecord);
  }

  /** Creates the membership or merges the roles into an existing one. */
  async addRoles(
    restaurantId: string,
    userId: string,
    roles: RestaurantRole[],
    session?: ClientSession,
  ): Promise<void> {
    await this.memberships.updateOne(
      { restaurantId: oid(restaurantId), userId: oid(userId) },
      { $addToSet: { roles: { $each: roles } } },
      { upsert: true, session },
    );
  }

  /** @returns false if the user is not a member. */
  async setRoles(
    restaurantId: string,
    userId: string,
    roles: RestaurantRole[],
    session?: ClientSession,
  ): Promise<boolean> {
    const result = await this.memberships.updateOne(
      { restaurantId: oid(restaurantId), userId: oid(userId) },
      { $set: { roles } },
      { session, runValidators: true },
    );
    return result.matchedCount === 1;
  }

  /** @returns false if the user was not a member. */
  async remove(restaurantId: string, userId: string, session?: ClientSession): Promise<boolean> {
    const result = await this.memberships.deleteOne(
      { restaurantId: oid(restaurantId), userId: oid(userId) },
      { session },
    );
    return result.deletedCount === 1;
  }

  async countOwners(restaurantId: string, session?: ClientSession): Promise<number> {
    return this.memberships.countDocuments({ restaurantId: oid(restaurantId), roles: "owner" }, { session });
  }
}

function toRecord(
  doc: Membership & { _id: Types.ObjectId; createdAt?: Date },
): MembershipRecord {
  return {
    restaurantId: doc.restaurantId.toString(),
    userId: doc.userId.toString(),
    roles: doc.roles,
    joinedAt: doc.createdAt ?? doc._id.getTimestamp(),
  };
}
