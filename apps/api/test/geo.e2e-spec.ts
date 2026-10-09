import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  ClientToServerEvents,
  CreatedOrder,
  DeliveryZoneView,
  MapConfig,
  OrderView,
  PublicDeliveryZone,
  RestaurantView,
  RiderPosition,
  ServerToClientEvents,
} from "@app/types";
import { io, type Socket } from "socket.io-client";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { fixtures, PASSWORD } from "./support/fixtures";
import { createTestApp, resetRateLimits, TEST_APP_URL, type TestContext } from "./support/test-app";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Two neighbouring squares in Santiago: Ñuñoa (east) and Providencia (west of it).
const NUNOA = [
  { lat: -33.45, lng: -70.6 },
  { lat: -33.45, lng: -70.58 },
  { lat: -33.47, lng: -70.58 },
  { lat: -33.47, lng: -70.6 },
];
const PROVIDENCIA = [
  { lat: -33.42, lng: -70.63 },
  { lat: -33.42, lng: -70.6 },
  { lat: -33.45, lng: -70.6 },
  { lat: -33.45, lng: -70.63 },
];
const IN_NUNOA = { lat: -33.456, lng: -70.59 };
const IN_PROVIDENCIA = { lat: -33.43, lng: -70.61 };
const NOWHERE = { lat: -33.3, lng: -70.4 };

describe("Maps, zones on the map and rider tracking (e2e)", () => {
  let ctx: TestContext;
  let f: ReturnType<typeof fixtures>;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    ctx = await createTestApp({ listen: true });
    f = fixtures(ctx);
    // A stand-in map archive: with the map available, zones drawn on it require the customer's pin.
    const s3 = new S3Client({
      endpoint: ctx.garage.env.S3_ENDPOINT,
      region: ctx.garage.env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: ctx.garage.env.S3_ACCESS_KEY_ID, secretAccessKey: ctx.garage.env.S3_SECRET_ACCESS_KEY },
    });
    await s3.send(
      new PutObjectCommand({ Bucket: ctx.garage.env.S3_BUCKET, Key: "maps/chile.pmtiles", Body: Buffer.from("PMTiles-test-0123456789") }),
    );
    s3.destroy();
  });

  beforeEach(async () => {
    await resetRateLimits(ctx.valkeyUrl);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  async function setup() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Completos Don Pepe");
    const base = `/api/restaurants/${restaurant.id}`;
    await owner.agent.patch(base).send({ deliveryEnabled: true }).expect(200);
    const zone = async (body: object) =>
      (await owner.agent.post(`${base}/delivery-zones`).send(body).expect(201)).body as DeliveryZoneView;
    const nunoa = await zone({ name: "Ñuñoa", fee: 1500, minOrder: 0, area: NUNOA, isHome: true });
    const providencia = await zone({ name: "Providencia", fee: 2500, minOrder: 0, area: PROVIDENCIA });
    const byName = await zone({ name: "La Reina", fee: 3000, minOrder: 0 });
    const category = (await owner.agent.post(`${base}/menu/categories`).send({ name: "Completos" }).expect(201)).body;
    const product = (
      await owner.agent.post(`${base}/menu/products`).send({ categoryId: category.id, name: "Completo", price: 3490 }).expect(201)
    ).body as { id: string };
    await owner.agent.put(`${base}/accepting-orders`).send({ acceptingOrders: true }).expect(200);
    const cart = (delivery: object) => ({
      clientOrderId: randomUUID(),
      customerName: "Berta",
      customerPhone: "9 1234 5678",
      items: [{ productId: product.id, quantity: 1, modifiers: [] }],
      delivery: { address: "Av. Grecia 1234", ...delivery },
      payment: { method: "cash" },
    });
    const place = (delivery: object) =>
      request(f.server).post(`/api/public/restaurants/${restaurant.slug}/delivery-orders`).send(cart(delivery));
    return { owner, restaurant, base, nunoa, providencia, byName, place };
  }

  describe("zones drawn on the map", () => {
    it("stores the area, publishes it and finds the zone of a pin", async () => {
      const s = await setup();
      expect(s.nunoa.area).toEqual(NUNOA);

      const zones = (await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/delivery-zones`).expect(200))
        .body as PublicDeliveryZone[];
      expect(zones.find((z) => z.name === "Providencia")?.area).toEqual(PROVIDENCIA);

      const locate = (point: object) =>
        request(f.server).post(`/api/public/restaurants/${s.restaurant.slug}/delivery-zones/locate`).send(point);
      expect(((await locate(IN_NUNOA).expect(200)).body as PublicDeliveryZone).id).toBe(s.nunoa.id);
      expect(((await locate(IN_PROVIDENCIA).expect(200)).body as PublicDeliveryZone).id).toBe(s.providencia.id);
      expect((await locate(NOWHERE).expect(404)).body.code).toBe("OUT_OF_DELIVERY_AREA");
      await locate({ lat: 200, lng: 0 }).expect(400);
    });

    it("rejects malformed and self-crossing areas, and can remove an area", async () => {
      const s = await setup();
      const zones = `${s.base}/delivery-zones`;

      expect((await s.owner.agent.post(zones).send({ name: "X", fee: 0, minOrder: 0, area: NUNOA.slice(0, 2) }).expect(400)).body.code).toBe(
        "INVALID_ZONE_AREA",
      );
      // A bow tie: the edges cross each other.
      const bowTie = [NUNOA[0], NUNOA[2], NUNOA[1], NUNOA[3]];
      expect((await s.owner.agent.post(zones).send({ name: "Y", fee: 0, minOrder: 0, area: bowTie }).expect(400)).body.code).toBe(
        "INVALID_ZONE_AREA",
      );

      const cleared = (await s.owner.agent.patch(`${zones}/${s.providencia.id}`).send({ area: null }).expect(200))
        .body as DeliveryZoneView;
      expect(cleared.area).toBeNull();
    });

    it("checks the customer's pin against the chosen zone", async () => {
      const s = await setup();

      expect((await s.place({ zoneId: s.nunoa.id }).expect(400)).body.code).toBe("LOCATION_REQUIRED");
      expect((await s.place({ zoneId: s.nunoa.id, location: IN_PROVIDENCIA }).expect(409)).body.code).toBe("OUTSIDE_ZONE");
      const { order } = (await s.place({ zoneId: s.nunoa.id, location: IN_NUNOA }).expect(201)).body as CreatedOrder;
      expect(order.delivery?.location).toEqual(IN_NUNOA);
      // Zones chosen by name still work without a pin.
      await s.place({ zoneId: s.byName.id }).expect(201);
    });

    it("lets the owner place the restaurant on the map", async () => {
      const s = await setup();

      const view = (await s.owner.agent.patch(s.base).send({ location: IN_NUNOA }).expect(200)).body as RestaurantView;
      expect(view.location).toEqual(IN_NUNOA);
      const menu = await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/menu`).expect(200);
      expect(menu.body.restaurant.location).toEqual(IN_NUNOA);
      expect(((await s.owner.agent.patch(s.base).send({ location: null }).expect(200)).body as RestaurantView).location).toBeNull();
    });
  });

  describe("base map files", () => {
    it("reports the map as available, serves byte ranges and refuses other keys", async () => {
      expect(((await request(f.server).get("/api/public/map-config").expect(200)).body as MapConfig).available).toBe(true);

      const ranged = await request(f.server).get("/api/public/maps/chile.pmtiles").set("Range", "bytes=0-6").expect(206);
      expect(ranged.headers["content-range"]).toBe("bytes 0-6/23");
      expect(ranged.headers["accept-ranges"]).toBe("bytes");
      expect(Buffer.from(ranged.body as Buffer).toString()).toBe("PMTiles");
      await request(f.server).get("/api/public/maps/restaurants/x/receipts/y.pdf").expect(404);
      await request(f.server).get("/api/public/maps/fonts/Noto%20Sans%20Regular/0-255.pbf").expect(404);
    });
  });

  describe("rider tracking", () => {
    async function connect(cookie?: string): Promise<ClientSocket> {
      const socket: ClientSocket = io(ctx.baseUrl, {
        transports: ["websocket"],
        extraHeaders: { origin: TEST_APP_URL, ...(cookie ? { cookie } : {}) },
        forceNew: true,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => resolve());
        socket.once("connect_error", reject);
      });
      return socket;
    }

    async function cookieOf(agent: TestAgent): Promise<string> {
      const me = await agent.get("/api/auth/me").expect(200);
      const res = await request(f.server).post("/api/auth/login").send({ email: me.body.email, password: PASSWORD }).expect(200);
      return (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("mm_at="))!.split(";")[0]!;
    }

    it("shares the assigned rider's position with the customer only while the delivery is on its way", async () => {
      const s = await setup();
      const rider = await f.staff(s.owner.agent, s.restaurant.id, ["rider"]);
      const riderId = (await rider.agent.get("/api/auth/me").expect(200)).body.id as string;
      const { accessToken } = (await s.place({ zoneId: s.nunoa.id, location: IN_NUNOA }).expect(201)).body as CreatedOrder;
      const [order] = (await s.owner.agent.get(`${s.base}/orders`).expect(200)).body as OrderView[];
      const status = (body: object) => s.owner.agent.post(`${s.base}/orders/${order!.id}/status`).send(body);
      await s.owner.agent.put(`${s.base}/orders/${order!.id}/rider`).send({ riderId }).expect(200);

      const riderSocket = await connect(await cookieOf(rider.agent));
      const report = (lat: number) =>
        riderSocket.timeout(5000).emitWithAck("rider.location", { orderId: order!.id, lat, lng: -70.59, accuracy: 8 });

      // Not on its way yet: refused.
      expect(await report(-33.457)).toEqual({ ok: false, code: "NOT_ON_THE_WAY" });

      for (const body of [{ status: "accepted", readyInMinutes: 30 }, { status: "preparing" }, { status: "ready" }]) {
        await status(body).expect(200);
      }
      await rider.agent.post(`${s.base}/deliveries/${order!.id}/status`).send({ status: "out_for_delivery" }).expect(200);

      const customer = await connect();
      expect(await customer.timeout(5000).emitWithAck("order.subscribe", accessToken)).toEqual({ ok: true });
      const live = new Promise<RiderPosition>((resolve) => customer.once("order.rider-location", resolve));

      expect(await report(-33.4571234567)).toEqual({ ok: true });
      expect(await live).toMatchObject({ lat: -33.457123, lng: -70.59, accuracy: 8 });
      const last = await request(f.server).post("/api/public/orders/rider-location").send({ accessToken }).expect(200);
      expect(last.body.position).toMatchObject({ lat: -33.457123 });

      // Someone else's socket cannot move the rider.
      const owner = await connect(await cookieOf(s.owner.agent));
      expect(
        await owner.timeout(5000).emitWithAck("rider.location", { orderId: order!.id, lat: -33.4, lng: -70.5 }),
      ).toEqual({ ok: false, code: "NOT_YOUR_DELIVERY" });

      // Delivered: the position is forgotten.
      await rider.agent.post(`${s.base}/deliveries/${order!.id}/payment`).send({ method: "cash" }).expect(200);
      await rider.agent.post(`${s.base}/deliveries/${order!.id}/status`).send({ status: "delivered" }).expect(200);
      const after = await request(f.server).post("/api/public/orders/rider-location").send({ accessToken }).expect(200);
      expect(after.body).toEqual({ position: null });
    });
  });
});
