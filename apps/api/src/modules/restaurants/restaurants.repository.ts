import type { RestaurantStatus } from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type ClientSession, type Model, Types } from "mongoose";
import { Restaurant } from "./schemas/restaurant.schema";

export interface RestaurantRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  phone: string;
  logoKey: string | null;
  currency: string;
  timezone: string;
  status: RestaurantStatus;
  createdBy: string;
}

export interface RestaurantChanges {
  name?: string;
  slug?: string;
  description?: string;
  phone?: string;
}

/** Thrown when the unique index on `slug` rejects a write. */
export class SlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`slug "${slug}" is taken`);
  }
}

const DUPLICATE_KEY = 11000;

@Injectable()
export class RestaurantsRepository {
  constructor(@InjectModel(Restaurant.name) private readonly restaurants: Model<Restaurant>) {}

  /** @throws SlugTakenError (relies on the unique index, so concurrent creations cannot share a slug). */
  async create(
    input: { name: string; slug: string; createdBy: string },
    session?: ClientSession,
  ): Promise<RestaurantRecord> {
    try {
      const [doc] = await this.restaurants.create(
        [{ ...input, createdBy: new Types.ObjectId(input.createdBy) }],
        { session },
      );
      return toRecord(doc!.toObject());
    } catch (error) {
      throw mapDuplicateSlug(error, input.slug);
    }
  }

  async findById(id: string): Promise<RestaurantRecord | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.restaurants.findById(id).lean();
    return doc ? toRecord(doc) : null;
  }

  async findByIds(ids: string[]): Promise<RestaurantRecord[]> {
    const docs = await this.restaurants.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }).lean();
    return docs.map(toRecord);
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.restaurants.exists({ slug })) !== null;
  }

  /** Slugs equal to `base` or `base-<n>`, to pick the next free suffix. */
  async findSlugFamily(base: string): Promise<string[]> {
    const pattern = new RegExp(`^${escapeRegex(base)}(-\\d+)?$`);
    const docs = await this.restaurants.find({ slug: pattern }, { slug: 1 }).lean();
    return docs.map((doc) => doc.slug);
  }

  /** @throws SlugTakenError when changing to a slug another restaurant uses. */
  async findBySlug(slug: string): Promise<RestaurantRecord | null> {
    const doc = await this.restaurants.findOne({ slug }).lean();
    return doc ? toRecord(doc) : null;
  }

  /**
   * Replaces the logo key atomically.
   * @returns The previous key (to delete its files), or undefined if the restaurant does not exist.
   */
  async setLogoKey(id: string, logoKey: string | null): Promise<string | null | undefined> {
    const previous = await this.restaurants
      .findByIdAndUpdate(id, { $set: { logoKey } }, { returnDocument: "before" })
      .lean();
    return previous ? (previous.logoKey ?? null) : undefined;
  }

  async update(id: string, changes: RestaurantChanges): Promise<RestaurantRecord | null> {
    try {
      const doc = await this.restaurants
        .findByIdAndUpdate(id, { $set: changes }, { returnDocument: "after", runValidators: true })
        .lean();
      return doc ? toRecord(doc) : null;
    } catch (error) {
      throw mapDuplicateSlug(error, changes.slug ?? "");
    }
  }

  /** Forces a write conflict between concurrent owner-membership transactions (see Restaurant.membershipVersion). */
  async bumpMembershipVersion(id: string, session: ClientSession): Promise<void> {
    await this.restaurants.updateOne({ _id: id }, { $inc: { membershipVersion: 1 } }, { session });
  }
}

function mapDuplicateSlug(error: unknown, slug: string): unknown {
  const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> };
  return duplicate.code === DUPLICATE_KEY && duplicate.keyPattern?.slug ? new SlugTakenError(slug) : error;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRecord(doc: Restaurant & { _id: Types.ObjectId }): RestaurantRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    slug: doc.slug,
    description: doc.description ?? "",
    phone: doc.phone ?? "",
    logoKey: doc.logoKey ?? null,
    currency: doc.currency,
    timezone: doc.timezone,
    status: doc.status,
    createdBy: doc.createdBy.toString(),
  };
}
