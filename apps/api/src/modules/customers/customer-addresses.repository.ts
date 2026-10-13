import type { GeoPoint } from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { CustomerAddress } from "./schemas/customer-address.schema";

export interface CustomerAddressRecord {
  id: string;
  userId: string;
  label: string;
  address: string;
  unit: string;
  reference: string;
  location: GeoPoint | null;
  createdAt: Date;
}

export interface CustomerAddressFields {
  label: string;
  address: string;
  unit: string;
  reference: string;
  location: GeoPoint | null;
}

const oid = (id: string) => new Types.ObjectId(id);

/** User-scoped: every method takes the owner's user id first, so nobody reads another customer's addresses. */
@Injectable()
export class CustomerAddressesRepository {
  constructor(@InjectModel(CustomerAddress.name) private readonly addresses: Model<CustomerAddress>) {}

  /** Oldest first: the order the customer added them. */
  async list(userId: string): Promise<CustomerAddressRecord[]> {
    const docs = await this.addresses.find({ userId: oid(userId) }).sort({ createdAt: 1, _id: 1 }).lean();
    return docs.map(toRecord);
  }

  async count(userId: string): Promise<number> {
    return this.addresses.countDocuments({ userId: oid(userId) });
  }

  async create(userId: string, fields: CustomerAddressFields): Promise<CustomerAddressRecord> {
    const doc = await this.addresses.create({ ...toDoc(fields), userId: oid(userId) });
    return toRecord(doc.toObject());
  }

  async update(userId: string, addressId: string, fields: CustomerAddressFields): Promise<CustomerAddressRecord | null> {
    if (!Types.ObjectId.isValid(addressId)) return null;
    const { location, ...rest } = fields;
    // No pin: remove the stored one instead of saving null.
    const update = location ? { $set: { ...rest, location } } : { $set: rest, $unset: { location: 1 } };
    const doc = await this.addresses
      .findOneAndUpdate({ _id: oid(addressId), userId: oid(userId) }, update, { returnDocument: "after" })
      .lean();
    return doc ? toRecord(doc) : null;
  }

  async delete(userId: string, addressId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(addressId)) return false;
    const result = await this.addresses.deleteOne({ _id: oid(addressId), userId: oid(userId) });
    return result.deletedCount === 1;
  }
}

function toDoc(fields: CustomerAddressFields) {
  const { location, ...rest } = fields;
  return location ? { ...rest, location } : rest;
}

type AddressDoc = CustomerAddress & { _id: Types.ObjectId; createdAt?: Date };

function toRecord(doc: AddressDoc): CustomerAddressRecord {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    label: doc.label,
    address: doc.address,
    unit: doc.unit ?? "",
    reference: doc.reference ?? "",
    location:
      typeof doc.location?.lat === "number" && typeof doc.location.lng === "number"
        ? { lat: doc.location.lat, lng: doc.location.lng }
        : null,
    createdAt: doc.createdAt ?? doc._id.getTimestamp(),
  };
}
