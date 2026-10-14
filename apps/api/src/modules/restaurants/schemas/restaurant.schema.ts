import {
  FLOOR_LIMITS,
  KITCHEN_TARGET_LIMITS,
  MESSAGE_CHANNELS,
  type MessagingSettings,
  type RestaurantStatus,
  TIP_LIMITS,
  type WeeklyHours,
} from "@app/types";
import { Prop, raw, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/** A rectangle of whole cells on the floor plan. */
@Schema({ _id: false })
export class FloorRectDoc {
  @Prop({ required: true, min: 0 })
  x!: number;

  @Prop({ required: true, min: 0 })
  y!: number;

  @Prop({ required: true, min: FLOOR_LIMITS.areaMin })
  w!: number;

  @Prop({ required: true, min: FLOOR_LIMITS.areaMin })
  h!: number;
}
const FloorRectSchema = SchemaFactory.createForClass(FloorRectDoc);

@Schema({ _id: false })
export class FloorCellDoc {
  @Prop({ required: true, min: 0 })
  x!: number;

  @Prop({ required: true, min: 0 })
  y!: number;
}
const FloorCellSchema = SchemaFactory.createForClass(FloorCellDoc);

/**
 * The restaurant drawn on a grid (phase 9, live view), validated by `floorPlanProblem` before saving. The
 * tables' positions live on each table (`tables.layout`).
 */
@Schema({ _id: false })
export class FloorPlanDoc {
  @Prop({ required: true, min: FLOOR_LIMITS.colsMin, max: FLOOR_LIMITS.colsMax })
  cols!: number;

  @Prop({ required: true, min: FLOOR_LIMITS.rowsMin, max: FLOOR_LIMITS.rowsMax })
  rows!: number;

  @Prop({ type: FloorRectSchema, required: true })
  kitchen!: FloorRectDoc;

  @Prop({ type: FloorRectSchema, default: null })
  pickup!: FloorRectDoc | null;

  @Prop({ type: FloorCellSchema, default: null })
  door!: FloorCellDoc | null;
}
const FloorPlanSchema = SchemaFactory.createForClass(FloorPlanDoc);

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

  /** Suggested tip on table bills, percent (phase 8). 0 = no suggestion. */
  @Prop({ default: TIP_LIMITS.percentDefault, min: 0, max: TIP_LIMITS.percentMax })
  tipPercent!: number;

  /** Minutes the owner expects from accepted to ready: the kitchen goal of the live view (phase 9). */
  @Prop({ default: KITCHEN_TARGET_LIMITS.minutesDefault, min: KITCHEN_TARGET_LIMITS.minutesMin, max: KITCHEN_TARGET_LIMITS.minutesMax })
  kitchenTargetMinutes!: number;

  /** The restaurant drawn for the live view (phase 9). null (or missing in older documents) = not drawn yet. */
  @Prop({ type: FloorPlanSchema, default: null })
  floorPlan!: FloorPlanDoc | null;

  /** WhatsApp/SMS notices to customers who ask for them (phase 8). */
  @Prop(
    raw({
      enabled: { type: Boolean, default: false },
      channel: { type: String, enum: MESSAGE_CHANNELS, default: "whatsapp" },
      senderPhone: { type: String, default: "" },
    }),
  )
  messaging?: MessagingSettings;

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
