import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { Product } from "./schemas/product.schema";

export interface ProductRecord {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  available: boolean;
  visible: boolean;
  imageKey: string | null;
  modifierGroupIds: string[];
  position: number;
}

export interface ProductInput {
  categoryId: string;
  name: string;
  description: string;
  price: number;
  visible: boolean;
  modifierGroupIds: string[];
}

const oid = (id: string) => new Types.ObjectId(id);

/** Tenant-scoped: every method takes the restaurant id first and filters by it. */
@Injectable()
export class ProductsRepository {
  constructor(@InjectModel(Product.name) private readonly products: Model<Product>) {}

  async list(restaurantId: string, options: { visibleOnly?: boolean } = {}): Promise<ProductRecord[]> {
    const filter = { restaurantId: oid(restaurantId), ...(options.visibleOnly ? { visible: true } : {}) };
    const docs = await this.products.find(filter).sort({ position: 1, _id: 1 }).lean();
    return docs.map(toRecord);
  }

  async findOne(restaurantId: string, productId: string): Promise<ProductRecord | null> {
    if (!Types.ObjectId.isValid(productId)) return null;
    const doc = await this.products.findOne({ _id: oid(productId), restaurantId: oid(restaurantId) }).lean();
    return doc ? toRecord(doc) : null;
  }

  /** Appends the product at the end of its category. */
  async create(restaurantId: string, input: ProductInput): Promise<ProductRecord> {
    const doc = await this.products.create({
      ...this.toDocument(input),
      restaurantId: oid(restaurantId),
      position: await this.nextPosition(restaurantId, input.categoryId),
    });
    return toRecord(doc.toObject());
  }

  /** Moving to another category appends the product at the end of the new one. */
  async update(
    restaurantId: string,
    productId: string,
    changes: Partial<ProductInput>,
    movedCategory: boolean,
  ): Promise<ProductRecord | null> {
    const set: Record<string, unknown> = { ...changes };
    if (changes.categoryId) set.categoryId = oid(changes.categoryId);
    if (changes.modifierGroupIds) set.modifierGroupIds = changes.modifierGroupIds.map(oid);
    if (movedCategory && changes.categoryId) set.position = await this.nextPosition(restaurantId, changes.categoryId);

    const doc = await this.products
      .findOneAndUpdate(
        { _id: oid(productId), restaurantId: oid(restaurantId) },
        { $set: set },
        { returnDocument: "after", runValidators: true },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  /** @returns The deleted product (its image must be removed from storage), or null. */
  async delete(restaurantId: string, productId: string): Promise<ProductRecord | null> {
    if (!Types.ObjectId.isValid(productId)) return null;
    const doc = await this.products
      .findOneAndDelete({ _id: oid(productId), restaurantId: oid(restaurantId) })
      .lean();
    return doc ? toRecord(doc) : null;
  }

  async countInCategory(restaurantId: string, categoryId: string): Promise<number> {
    return this.products.countDocuments({ restaurantId: oid(restaurantId), categoryId: oid(categoryId) });
  }

  async idsInCategory(restaurantId: string, categoryId: string): Promise<string[]> {
    const docs = await this.products
      .find({ restaurantId: oid(restaurantId), categoryId: oid(categoryId) }, { _id: 1 })
      .lean();
    return docs.map((doc) => doc._id.toString());
  }

  async reorderInCategory(restaurantId: string, categoryId: string, orderedIds: string[]): Promise<void> {
    await this.products.bulkWrite(
      orderedIds.map((id, position) => ({
        updateOne: {
          filter: { _id: oid(id), restaurantId: oid(restaurantId), categoryId: oid(categoryId) },
          update: { $set: { position } },
        },
      })),
    );
  }

  /** @returns false if the product does not exist in this restaurant. */
  async setAvailability(restaurantId: string, productId: string, available: boolean): Promise<boolean> {
    if (!Types.ObjectId.isValid(productId)) return false;
    const result = await this.products.updateOne(
      { _id: oid(productId), restaurantId: oid(restaurantId) },
      { $set: { available } },
    );
    return result.matchedCount === 1;
  }

  /** @returns The previous image key, or undefined if the product does not exist. */
  async setImageKey(restaurantId: string, productId: string, imageKey: string | null): Promise<string | null | undefined> {
    if (!Types.ObjectId.isValid(productId)) return undefined;
    const previous = await this.products
      .findOneAndUpdate(
        { _id: oid(productId), restaurantId: oid(restaurantId) },
        { $set: { imageKey } },
        { returnDocument: "before" },
      )
      .lean();
    return previous ? (previous.imageKey ?? null) : undefined;
  }

  /** Detaches a deleted modifier group from every product of the restaurant. */
  async removeModifierGroup(restaurantId: string, groupId: string): Promise<void> {
    await this.products.updateMany(
      { restaurantId: oid(restaurantId), modifierGroupIds: oid(groupId) },
      { $pull: { modifierGroupIds: oid(groupId) } },
    );
  }

  /** Group id → number of products using it. */
  async countByModifierGroup(restaurantId: string): Promise<Map<string, number>> {
    const rows = await this.products.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { restaurantId: oid(restaurantId) } },
      { $unwind: "$modifierGroupIds" },
      { $group: { _id: "$modifierGroupIds", count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [row._id.toString(), row.count]));
  }

  private async nextPosition(restaurantId: string, categoryId: string): Promise<number> {
    const last = await this.products
      .findOne({ restaurantId: oid(restaurantId), categoryId: oid(categoryId) }, { position: 1 })
      .sort({ position: -1 })
      .lean();
    return last ? last.position + 1 : 0;
  }

  private toDocument(input: ProductInput) {
    return { ...input, categoryId: oid(input.categoryId), modifierGroupIds: input.modifierGroupIds.map(oid) };
  }
}

function toRecord(doc: Product & { _id: Types.ObjectId }): ProductRecord {
  return {
    id: doc._id.toString(),
    categoryId: doc.categoryId.toString(),
    name: doc.name,
    description: doc.description ?? "",
    price: doc.price,
    available: doc.available,
    visible: doc.visible,
    imageKey: doc.imageKey ?? null,
    modifierGroupIds: (doc.modifierGroupIds ?? []).map((id) => id.toString()),
    position: doc.position,
  };
}
