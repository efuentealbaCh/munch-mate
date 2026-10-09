import type { RestaurantStatus, WeeklyHours } from "@app/types";
import { Prop, raw, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/** A tenant. Single location in the MVP: one address, one schedule, one menu. */
@Schema({ collection: "restaurants", timestamps: true })
export class Restaurant {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name!: string;

  /** Public identifier in `/r/{slug}`. Unique across the platform. */
  @Prop({ required: true, unique: true })
  slug!: string;

  /** Short text under the name in the public menu. */
  @Prop({ default: "", trim: true, maxlength: 300 })
  description!: string;

  @Prop({ default: "", trim: true, maxlength: 20 })
  phone!: string;

  /** Base key of the logo in the media bucket (variants `<key>-<size>.webp`). */
  @Prop({ type: String, default: null })
  logoKey!: string | null;

  /** Manual open/closed switch: customers can only place orders while true. Starts closed. */
  @Prop({ default: false })
  acceptingOrders!: boolean;

  /** Customers may order for pickup from the public menu. Owner setting, off until the owner enables it. */
  @Prop({ default: false })
  pickupEnabled!: boolean;

  /** Customers may order for delivery to the restaurant's delivery zones. Owner setting, off by default. */
  @Prop({ default: false })
  deliveryEnabled!: boolean;

  /**
   * Weekly schedule (Monday first), validated by `openingHoursProblem` before saving. null = no schedule:
   * only the manual switch decides.
   */
  @Prop({ type: [[{ _id: false, open: String, close: String }]], default: null })
  openingHours!: WeeklyHours | null;

  /** Units (sum of quantities) allowed in one order; stops absurd carts (ORDER_LIMITS.itemsPerOrder*). */
  @Prop({ default: 50, min: 1, max: 500 })
  maxItemsPerOrder!: number;

  /** Where the restaurant is ({ lat, lng }, set by the owner on the map); centers maps. */
  @Prop(raw({ lat: { type: Number }, lng: { type: Number } }))
  location?: { lat: number; lng: number };

  /** ISO 4217. Amounts are stored as integers in the currency's minor unit (CLP has none). */
  @Prop({ required: true, default: "CLP" })
  currency!: string;

  /** IANA zone; defines the business day for daily ticket numbers. */
  @Prop({ required: true, default: "America/Santiago" })
  timezone!: string;

  @Prop({ type: String, enum: ["active", "suspended"], default: "active" })
  status!: RestaurantStatus;

  @Prop({ type: Types.ObjectId, required: true })
  createdBy!: Types.ObjectId;

  /**
   * Bumped inside every transaction that changes owner memberships. Two concurrent transactions that each
   * demote a different owner would otherwise both see "another owner remains" (write skew) and leave the
   * restaurant without owners; writing this shared document makes one of them conflict and retry.
   */
  @Prop({ default: 0 })
  membershipVersion!: number;
}

export type RestaurantDocument = HydratedDocument<Restaurant>;
export const RestaurantSchema = SchemaFactory.createForClass(Restaurant);
