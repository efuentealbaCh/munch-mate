import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { DeliveryZone } from "./schemas/delivery-zone.schema";

export interface DeliveryZoneRecord {
  id: string;
  restaurantId: string;
  name: string;
  fee: number;
  minOrder: number;
  active: boolean;
  isHome: boolean;
  position: number;
}

export type DeliveryZoneChanges = Partial<Pick<DeliveryZoneRecord, "name" | "fee" | "minOrder" | "active" | "isHome">>;

const oid = (id: string) => new Types.ObjectId(id);

/** Tenant-scoped: every method takes the restaurant id first. */
@Injectable()
export class DeliveryZonesRepository {
  constructor(@InjectModel(DeliveryZone.name) private readonly zones: Model<DeliveryZone>) {}

  /** In display order. */
  async list(restaurantId: string, options: { activeOnly?: boolean } = {}): Promise<DeliveryZoneRecord[]> {
    const filter = { restaurantId: oid(restaurantId), ...(options.activeOnly ? { active: true } : {}) };
    const docs = await this.zones.find(filter).sort({ position: 1, _id: 1 }).lean();
    return docs.map(toRecord);
  }

  async findOne(restaurantId: string, zoneId: string): Promise<DeliveryZoneRecord | null> {
    if (!Types.ObjectId.isValid(zoneId)) return null;
    const doc = await this.zones.findOne({ _id: oid(zoneId), restaurantId: oid(restaurantId) }).lean();
    return doc ? toRecord(doc) : null;
  }

  async count(restaurantId: string): Promise<number> {
    return this.zones.countDocuments({ restaurantId: oid(restaurantId) });
  }

  /** Appended at the end of the list. */
  async create(
    restaurantId: string,
    input: Pick<DeliveryZoneRecord, "name" | "fee" | "minOrder" | "active" | "isHome">,
  ): Promise<DeliveryZoneRecord> {
    const last = await this.zones.findOne({ restaurantId: oid(restaurantId) }).sort({ position: -1 }).lean();
    const doc = await this.zones.create({ ...input, restaurantId: oid(restaurantId), position: (last?.position ?? -1) + 1 });
    return toRecord(doc.toObject());
  }

  async update(restaurantId: string, zoneId: string, changes: DeliveryZoneChanges): Promise<DeliveryZoneRecord | null> {
    if (!Types.ObjectId.isValid(zoneId)) return null;
    const doc = await this.zones
      .findOneAndUpdate({ _id: oid(zoneId), restaurantId: oid(restaurantId) }, { $set: changes }, { returnDocument: "after" })
      .lean();
    return doc ? toRecord(doc) : null;
  }

  /** Clears the home flag on every zone of the restaurant except `keepId`. */
  async clearHome(restaurantId: string, keepId: string): Promise<void> {
    await this.zones.updateMany(
      { restaurantId: oid(restaurantId), _id: { $ne: oid(keepId) }, isHome: true },
      { $set: { isHome: false } },
    );
  }

  /** @returns Whether a zone was deleted. Past orders keep their own snapshot of the zone. */
  async delete(restaurantId: string, zoneId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(zoneId)) return false;
    const result = await this.zones.deleteOne({ _id: oid(zoneId), restaurantId: oid(restaurantId) });
    return result.deletedCount === 1;
  }
}

function toRecord(doc: DeliveryZone & { _id: Types.ObjectId }): DeliveryZoneRecord {
  return {
    id: doc._id.toString(),
    restaurantId: doc.restaurantId.toString(),
    name: doc.name,
    fee: doc.fee,
    minOrder: doc.minOrder ?? 0,
    active: doc.active ?? true,
    isHome: doc.isHome ?? false,
    position: doc.position ?? 0,
  };
}
