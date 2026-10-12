import type { GeoArea, GeoPoint } from "@app/types";
import { roundCoord } from "@app/utils";
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
  area: GeoArea | null;
}

export type DeliveryZoneChanges = Partial<
  Pick<DeliveryZoneRecord, "name" | "fee" | "minOrder" | "active" | "isHome" | "area">
>;

/** Thrown when MongoDB rejects the polygon (self-crossing edges, degenerate ring). */
export class InvalidAreaError extends Error {}

const INVALID_GEOMETRY = 16755;

/** Map vertices → GeoJSON Polygon (lng/lat order, closed ring). */
function toPolygon(area: GeoArea): { type: "Polygon"; coordinates: number[][][] } {
  const ring = area.map((p) => [roundCoord(p.lng), roundCoord(p.lat)]);
  return { type: "Polygon", coordinates: [[...ring, ring[0]!]] };
}

/** Builds the $set/$unset of a change that may set or remove the area. */
function areaUpdate(changes: DeliveryZoneChanges): Record<string, unknown> {
  const { area, ...rest } = changes;
  if (area === undefined) return { $set: rest };
  if (area === null) return { $set: rest, $unset: { area: 1 } };
  return { $set: { ...rest, area: toPolygon(area) } };
}

function rethrowGeometry(error: unknown): never {
  if ((error as { code?: number }).code === INVALID_GEOMETRY) throw new InvalidAreaError();
  throw error;
}

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

  /** Appended at the end of the list. @throws InvalidAreaError when MongoDB rejects the polygon. */
  async create(
    restaurantId: string,
    input: Pick<DeliveryZoneRecord, "name" | "fee" | "minOrder" | "active" | "isHome" | "area">,
  ): Promise<DeliveryZoneRecord> {
    const last = await this.zones.findOne({ restaurantId: oid(restaurantId) }).sort({ position: -1 }).lean();
    const { area, ...fields } = input;
    try {
      const doc = await this.zones.create({
        ...fields,
        ...(area ? { area: toPolygon(area) } : {}),
        restaurantId: oid(restaurantId),
        position: (last?.position ?? -1) + 1,
      });
      return toRecord(doc.toObject());
    } catch (error) {
      rethrowGeometry(error);
    }
  }

  /**
   * Active zones whose area contains the point, in display order (the first wins when areas overlap).
   */
  async locate(restaurantId: string, point: GeoPoint): Promise<DeliveryZoneRecord[]> {
    const docs = await this.zones
      .find({
        restaurantId: oid(restaurantId),
        active: true,
        area: { $geoIntersects: { $geometry: { type: "Point", coordinates: [point.lng, point.lat] } } },
      })
      .sort({ position: 1, _id: 1 })
      .lean();
    return docs.map(toRecord);
  }

  /** Whether the zone's area contains the point. */
  async contains(restaurantId: string, zoneId: string, point: GeoPoint): Promise<boolean> {
    if (!Types.ObjectId.isValid(zoneId)) return false;
    const count = await this.zones.countDocuments({
      _id: oid(zoneId),
      restaurantId: oid(restaurantId),
      area: { $geoIntersects: { $geometry: { type: "Point", coordinates: [point.lng, point.lat] } } },
    });
    return count > 0;
  }

  /** @throws InvalidAreaError when MongoDB rejects the polygon. */
  async update(restaurantId: string, zoneId: string, changes: DeliveryZoneChanges): Promise<DeliveryZoneRecord | null> {
    if (!Types.ObjectId.isValid(zoneId)) return null;
    try {
      const doc = await this.zones
        .findOneAndUpdate({ _id: oid(zoneId), restaurantId: oid(restaurantId) }, areaUpdate(changes), {
          returnDocument: "after",
        })
        .lean();
      return doc ? toRecord(doc) : null;
    } catch (error) {
      rethrowGeometry(error);
    }
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
    // Drop the closing vertex: the app works with open rings.
    area: doc.area?.coordinates?.[0]?.slice(0, -1).map(([lng, lat]) => ({ lat: lat!, lng: lng! })) ?? null,
  };
}
