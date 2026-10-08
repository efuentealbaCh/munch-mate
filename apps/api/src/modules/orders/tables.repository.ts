import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { Table } from "./schemas/table.schema";

export interface TableRecord {
  id: string;
  restaurantId: string;
  label: string;
  token: string;
  active: boolean;
}

const oid = (id: string) => new Types.ObjectId(id);
const DUPLICATE_KEY = 11000;

/** Tenant-scoped, except the lookup by token used by the customer's phone after scanning the QR. */
@Injectable()
export class TablesRepository {
  constructor(@InjectModel(Table.name) private readonly tables: Model<Table>) {}

  /** Tables in natural order ("Mesa 2" before "Mesa 10"). */
  async list(restaurantId: string): Promise<TableRecord[]> {
    const docs = await this.tables
      .find({ restaurantId: oid(restaurantId) })
      .collation({ locale: "es", numericOrdering: true })
      .sort({ label: 1 })
      .lean();
    return docs.map(toRecord);
  }

  async findOne(restaurantId: string, tableId: string): Promise<TableRecord | null> {
    if (!Types.ObjectId.isValid(tableId)) return null;
    const doc = await this.tables.findOne({ _id: oid(tableId), restaurantId: oid(restaurantId) }).lean();
    return doc ? toRecord(doc) : null;
  }

  async findByToken(token: string): Promise<TableRecord | null> {
    const doc = await this.tables.findOne({ token }).lean();
    return doc ? toRecord(doc) : null;
  }

  /**
   * @param newToken Generates a candidate token; retried on the (astronomically rare) unique collision.
   */
  async create(restaurantId: string, label: string, newToken: () => string): Promise<TableRecord> {
    for (let attempt = 0; ; attempt++) {
      try {
        const doc = await this.tables.create({ restaurantId: oid(restaurantId), label, token: newToken() });
        return toRecord(doc.toObject());
      } catch (error) {
        if ((error as { code?: number }).code !== DUPLICATE_KEY || attempt >= 3) throw error;
      }
    }
  }

  async update(
    restaurantId: string,
    tableId: string,
    changes: { label?: string; active?: boolean; token?: string },
  ): Promise<TableRecord | null> {
    if (!Types.ObjectId.isValid(tableId)) return null;
    const doc = await this.tables
      .findOneAndUpdate(
        { _id: oid(tableId), restaurantId: oid(restaurantId) },
        { $set: changes },
        { returnDocument: "after", runValidators: true },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  async delete(restaurantId: string, tableId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(tableId)) return false;
    const result = await this.tables.deleteOne({ _id: oid(tableId), restaurantId: oid(restaurantId) });
    return result.deletedCount === 1;
  }
}

function toRecord(doc: Table & { _id: Types.ObjectId }): TableRecord {
  return {
    id: doc._id.toString(),
    restaurantId: doc.restaurantId.toString(),
    label: doc.label,
    token: doc.token,
    active: doc.active,
  };
}
