import { GEO_LIMITS, type RiderPosition } from "@app/types";
import { isGeoPoint, roundCoord } from "@app/utils";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { VALKEY } from "../../infra/redis/redis.module";
import { RealtimeService } from "../realtime/realtime.service";
import { MembershipsRepository } from "../restaurants/memberships.repository";
import { OrdersRepository } from "./orders.repository";

export type RiderReportResult = { ok: true } | { ok: false; code: "INVALID_POSITION" | "ORDER_NOT_FOUND" | "NOT_YOUR_DELIVERY" | "NOT_ON_THE_WAY" };

const key = (orderId: string) => `cache:rider-location:${orderId}`;

/**
 * Live position of the rider of a delivery on its way. Only the last position is kept, in Valkey with a
 * TTL, and it is deleted when the delivery ends: the platform keeps no location history.
 */
@Injectable()
export class RiderTrackingService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly memberships: MembershipsRepository,
    private readonly realtime: RealtimeService,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  /**
   * A report from the rider's phone. Accepted only from the rider assigned to that delivery, while it is
   * "out_for_delivery"; reports closer than GEO_LIMITS.riderReportMinSeconds are dropped (battery and
   * bandwidth on the rider's side, noise on the customer's map).
   */
  async report(
    userId: string,
    report: { orderId?: unknown; lat?: unknown; lng?: unknown; accuracy?: unknown },
  ): Promise<RiderReportResult> {
    const point = { lat: report.lat, lng: report.lng };
    if (typeof report.orderId !== "string" || !isGeoPoint(point)) return { ok: false, code: "INVALID_POSITION" };

    const order = await this.orders.findById(report.orderId);
    if (!order || order.channel !== "delivery") return { ok: false, code: "ORDER_NOT_FOUND" };
    // Membership re-checked on every report: a rider removed from the team stops being followed at once.
    const member = await this.memberships.findOne(order.restaurantId, userId);
    if (!member || order.riderId !== userId) return { ok: false, code: "NOT_YOUR_DELIVERY" };
    if (order.status !== "out_for_delivery") return { ok: false, code: "NOT_ON_THE_WAY" };

    const last = await this.lastPosition(order.id);
    if (last && Date.now() - Date.parse(last.at) < GEO_LIMITS.riderReportMinSeconds * 1000) return { ok: true };

    const accuracy =
      typeof report.accuracy === "number" && Number.isFinite(report.accuracy) && report.accuracy >= 0
        ? Math.round(report.accuracy)
        : null;
    const position: RiderPosition = {
      lat: roundCoord(point.lat),
      lng: roundCoord(point.lng),
      accuracy,
      at: new Date().toISOString(),
    };
    await this.valkey.set(key(order.id), JSON.stringify(position), "EX", GEO_LIMITS.riderPositionTtlSeconds);
    const event = { orderId: order.id, ...position };
    this.realtime.toOrder(order.id).emit("order.rider-location", event);
    this.realtime.toStaffOf(order.restaurantId, [order.riderId]).emit("order.rider-location", event);
    return { ok: true };
  }

  /** @returns The last position (if still fresh), or null. */
  async lastPosition(orderId: string): Promise<RiderPosition | null> {
    const raw = await this.valkey.get(key(orderId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RiderPosition;
    } catch {
      // Unreadable leftover: treat as "no position" and let the next report overwrite it.
      return null;
    }
  }

  /** Forgets the position once the delivery is no longer on its way. */
  async clear(orderId: string): Promise<void> {
    await this.valkey.del(key(orderId));
  }
}
