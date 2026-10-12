import type { Redis } from "ioredis";
import type { RealtimeService } from "../realtime/realtime.service";
import type { MembershipsRepository } from "../restaurants/memberships.repository";
import type { OrderRecord, OrdersRepository } from "./orders.repository";
import { RiderTrackingService } from "./rider-tracking.service";

function setup(order: Partial<OrderRecord> | null = {}, member = true) {
  const store = new Map<string, string>();
  const emitted: { room: string; payload: unknown }[] = [];
  const room = (name: string) => ({ emit: (_event: string, payload: unknown) => emitted.push({ room: name, payload }) });
  const record =
    order === null
      ? null
      : ({ id: "o1", restaurantId: "r1", channel: "delivery", status: "out_for_delivery", riderId: "rider1", ...order } as OrderRecord);
  const service = new RiderTrackingService(
    { findById: jest.fn(async () => record) } as unknown as OrdersRepository,
    { findOne: jest.fn(async () => (member ? { roles: ["rider"] } : null)) } as unknown as MembershipsRepository,
    {
      toOrder: (id: string) => room(`order:${id}`),
      toStaffOf: (id: string) => room(`restaurant:${id}`),
    } as unknown as RealtimeService,
    {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => store.set(k, v)),
      del: jest.fn(async (k: string) => store.delete(k)),
    } as unknown as Redis,
  );
  return { service, store, emitted };
}

const report = { orderId: "o1", lat: -33.4567891234, lng: -70.6, accuracy: 12.4 };

describe("RiderTrackingService", () => {
  it("stores the assigned rider's position, rounded, and tells the customer and the staff", async () => {
    const { service, emitted } = setup();

    await expect(service.report("rider1", report)).resolves.toEqual({ ok: true });

    expect(await service.lastPosition("o1")).toMatchObject({ lat: -33.456789, lng: -70.6, accuracy: 12 });
    expect(emitted.map((e) => e.room)).toEqual(["order:o1", "restaurant:r1"]);
  });

  it.each([
    ["another rider", {}, true, "other", "NOT_YOUR_DELIVERY"],
    ["a removed member", {}, false, "rider1", "NOT_YOUR_DELIVERY"],
    ["a delivery not on its way yet", { status: "ready" as const }, true, "rider1", "NOT_ON_THE_WAY"],
    ["a pickup order", { channel: "pickup" as const }, true, "rider1", "ORDER_NOT_FOUND"],
  ])("ignores %s", async (_, order, member, userId, code) => {
    const { service, store } = setup(order, member);

    await expect(service.report(userId, report)).resolves.toEqual({ ok: false, code });
    expect(store.size).toBe(0);
  });

  it("rejects malformed positions", async () => {
    await expect(setup().service.report("rider1", { orderId: "o1", lat: 200, lng: 0 })).resolves.toEqual({
      ok: false,
      code: "INVALID_POSITION",
    });
  });

  it("drops reports that come too fast, and forgets the position on clear", async () => {
    const { service, emitted } = setup();

    await service.report("rider1", report);
    await service.report("rider1", { ...report, lat: -33.5 });

    expect(emitted).toHaveLength(2); // one report, two rooms
    await service.clear("o1");
    expect(await service.lastPosition("o1")).toBeNull();
  });
});
