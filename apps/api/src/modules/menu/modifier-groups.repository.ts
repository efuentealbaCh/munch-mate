import type { ModifierOptionView } from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { ModifierGroup } from "./schemas/modifier-group.schema";

export interface ModifierGroupRecord {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOptionView[];
}

export interface ModifierGroupInput {
  name: string;
  minSelect: number;
  maxSelect: number;
  /** Options with an `id` keep it (so references survive edits); new ones get a fresh id. */
  options: { id?: string; name: string; priceDelta: number; available: boolean }[];
}

const oid = (id: string) => new Types.ObjectId(id);

/** Tenant-scoped: every method takes the restaurant id first and filters by it. */
@Injectable()
export class ModifierGroupsRepository {
  constructor(@InjectModel(ModifierGroup.name) private readonly groups: Model<ModifierGroup>) {}

  async list(restaurantId: string): Promise<ModifierGroupRecord[]> {
    const docs = await this.groups.find({ restaurantId: oid(restaurantId) }).sort({ name: 1, _id: 1 }).lean();
    return docs.map(toRecord);
  }

  async findOne(restaurantId: string, groupId: string): Promise<ModifierGroupRecord | null> {
    if (!Types.ObjectId.isValid(groupId)) return null;
    const doc = await this.groups.findOne({ _id: oid(groupId), restaurantId: oid(restaurantId) }).lean();
    return doc ? toRecord(doc) : null;
  }

  /** Ids among `groupIds` that belong to the restaurant (used to reject other tenants' groups). */
  async existingIds(restaurantId: string, groupIds: string[]): Promise<Set<string>> {
    const valid = groupIds.filter((id) => Types.ObjectId.isValid(id));
    const docs = await this.groups
      .find({ _id: { $in: valid.map(oid) }, restaurantId: oid(restaurantId) }, { _id: 1 })
      .lean();
    return new Set(docs.map((doc) => doc._id.toString()));
  }

  async create(restaurantId: string, input: ModifierGroupInput): Promise<ModifierGroupRecord> {
    const doc = await this.groups.create({ ...toDocument(input), restaurantId: oid(restaurantId) });
    return toRecord(doc.toObject());
  }

  async replace(restaurantId: string, groupId: string, input: ModifierGroupInput): Promise<ModifierGroupRecord | null> {
    if (!Types.ObjectId.isValid(groupId)) return null;
    const doc = await this.groups
      .findOneAndUpdate(
        { _id: oid(groupId), restaurantId: oid(restaurantId) },
        { $set: toDocument(input) },
        { returnDocument: "after", runValidators: true },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  async delete(restaurantId: string, groupId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(groupId)) return false;
    const result = await this.groups.deleteOne({ _id: oid(groupId), restaurantId: oid(restaurantId) });
    return result.deletedCount === 1;
  }

  /** @returns false if the group or option does not exist in this restaurant. */
  async setOptionAvailability(
    restaurantId: string,
    groupId: string,
    optionId: string,
    available: boolean,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(groupId) || !Types.ObjectId.isValid(optionId)) return false;
    const result = await this.groups.updateOne(
      { _id: oid(groupId), restaurantId: oid(restaurantId), "options._id": oid(optionId) },
      { $set: { "options.$.available": available } },
    );
    return result.matchedCount === 1;
  }
}

function toDocument(input: ModifierGroupInput) {
  return {
    name: input.name,
    minSelect: input.minSelect,
    maxSelect: input.maxSelect,
    options: input.options.map((option) => ({
      _id: option.id && Types.ObjectId.isValid(option.id) ? oid(option.id) : new Types.ObjectId(),
      name: option.name,
      priceDelta: option.priceDelta,
      available: option.available,
    })),
  };
}

function toRecord(doc: ModifierGroup & { _id: Types.ObjectId }): ModifierGroupRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    minSelect: doc.minSelect,
    maxSelect: doc.maxSelect,
    options: doc.options.map((option) => ({
      id: option._id.toString(),
      name: option.name,
      priceDelta: option.priceDelta,
      available: option.available,
    })),
  };
}
