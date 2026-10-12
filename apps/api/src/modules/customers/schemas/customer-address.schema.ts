import { Prop, raw, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/** A delivery address saved by a customer. User-scoped, not tenant-scoped: it works in any restaurant. */
@Schema({ collection: "customer_addresses", timestamps: true })
export class CustomerAddress {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  label!: string;

  @Prop({ required: true })
  address!: string;

  @Prop({ default: "" })
  unit!: string;

  @Prop({ default: "" })
  reference!: string;

  /** The pin, when the customer placed one: picks the zone automatically in each restaurant. */
  @Prop(raw({ lat: { type: Number }, lng: { type: Number } }))
  location?: { lat: number; lng: number };
}

export type CustomerAddressDocument = HydratedDocument<CustomerAddress>;
export const CustomerAddressSchema = SchemaFactory.createForClass(CustomerAddress);
