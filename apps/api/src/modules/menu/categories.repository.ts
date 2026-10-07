import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { MenuCategory } from "./schemas/menu-category.schema";

export interface CategoryRecord {
  id: string;
  name: string;
  description: string;
  active: boolean;
  position: number;
}

const oid = (id: string) => new Types.ObjectId(id);

/** Tenant-scoped: every method takes the restaurant id first and filters by it. */
@Injectable()
export class CategoriesRepository {
  constructor(@InjectModel(MenuCategory.name) private readonly categories: Model<MenuCategory>) {}

  async list(restaurantId: string, options: { activeOnly?: boolean } = {}): Promise<CategoryRecord[]> {
    const filter = { restaurantId: oid(restaurantId), ...(options.activeOnly ? { active: true } : {}) };
    const docs = await this.categories.find(filter).sort({ position: 1, _id: 1 }).lean();
    return docs.map(toRecord);
  }

  async exists(restaurantId: string, categoryId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(categoryId)) return false;
    return (await this.categories.exists({ _id: oid(categoryId), restaurantId: oid(restaurantId) })) !== null;
  }

  /** Appends the category at the end of the menu. */
  async create(restaurantId: string, input: { name: string; description: string }): Promise<CategoryRecord> {
    const last = await this.categories
      .findOne({ restaurantId: oid(restaurantId) }, { position: 1 })
      .sort({ position: -1 })
      .lean();
    const doc = await this.categories.create({
      ...input,
      restaurantId: oid(restaurantId),
      position: last ? last.position + 1 : 0,
    });
    return toRecord(doc.toObject());
  }

  async update(
    restaurantId: string,
    categoryId: string,
    changes: { name?: string; description?: string; active?: boolean },
  ): Promise<CategoryRecord | null> {
    if (!Types.ObjectId.isValid(categoryId)) return null;
    const doc = await this.categories
      .findOneAndUpdate(
        { _id: oid(categoryId), restaurantId: oid(restaurantId) },
        { $set: changes },
        { returnDocument: "after", runValidators: true },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  async delete(restaurantId: string, categoryId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(categoryId)) return false;
    const result = await this.categories.deleteOne({ _id: oid(categoryId), restaurantId: oid(restaurantId) });
    return result.deletedCount === 1;
  }

  /** Rewrites positions to match `orderedIds` (which the service validated as the complete set). */
  async reorder(restaurantId: string, orderedIds: string[]): Promise<void> {
    await this.categories.bulkWrite(
      orderedIds.map((id, position) => ({
        updateOne: { filter: { _id: oid(id), restaurantId: oid(restaurantId) }, update: { $set: { position } } },
      })),
    );
  }
}

function toRecord(doc: MenuCategory & { _id: Types.ObjectId }): CategoryRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description ?? "",
    active: doc.active,
    position: doc.position,
  };
}
