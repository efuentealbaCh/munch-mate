import { randomUUID } from "node:crypto";
import {
  type CreatedOrder,
  type DeliveryZoneView,
  type ModifierGroupView,
  type OrderView,
  type ProductView,
  type PublicDeliveryZone,
  type PublicMenu,
  type PublicOrderView,
  QUEUES,
  type ReceiptJob,
  type RiderView,
} from "@app/types";
import { Queue } from "bullmq";
import request from "supertest";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, type TestContext } from "./support/test-app";

describe("Delivery orders (e2e)", () => {
  let ctx: TestContext;
  let f: ReturnType<typeof fixtures>;

  beforeAll(async () => {
    ctx = await createTestApp();
    f = fixtures(ctx);
  });

  beforeEach(async () => {
    await resetRateLimits(ctx.valkeyUrl);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  /** Owner + open restaurant with delivery enabled, two zones (home first) and one $3.490 product. */
  async function setup(options: { deliveryEnabled?: boolean } = {}) {
    const { owner, restaurant } = await f.ownerWithRestaurant("Completos Don Pepe");
    const base = `/api/restaurants/${restaurant.id}`;
    await owner.agent.patch(base).send({ deliveryEnabled: options.deliveryEnabled ?? true }).expect(200);
    const zone = async (body: object) =>
      (await owner.agent.post(`${base}/delivery-zones`).send(body).expect(201)).body as DeliveryZoneView;
    const providencia = await zone({ name: "Providencia", fee: 2500, minOrder: 10000 });
    const nunoa = await zone({ name: "Ñuñoa", fee: 1500, minOrder: 5000, isHome: true });
    const category = (await owner.agent.post(`${base}/menu/categories`).send({ name: "Completos" }).expect(201)).body;
    const size = (
      await owner.agent
        .post(`${base}/menu/modifier-groups`)
        .send({ name: "Tamaño", minSelect: 1, maxSelect: 1, options: [{ name: "Normal", priceDelta: 0 }] })
        .expect(201)
    ).body as ModifierGroupView;
    const completo = (
      await owner.agent
        .post(`${base}/menu/products`)
        .send({ categoryId: category.id, name: "Completo italiano", price: 3490, modifierGroupIds: [size.id] })
        .expect(201)
    ).body as ProductView;
    await owner.agent.put(`${base}/accepting-orders`).send({ acceptingOrders: true }).expect(200);

    const cart = (overrides: Record<string, unknown> = {}) => ({
      clientOrderId: randomUUID(),
      customerName: "Berta",
      customerPhone: "9 1234 5678",
      customerEmail: "berta@example.com",
      items: [{ productId: completo.id, quantity: 2, modifiers: [{ groupId: size.id, optionIds: [size.options[0]!.id] }] }],
      delivery: { zoneId: nunoa.id, address: "Av. Grecia 1234", unit: "Depto 5", reference: "Portón verde" },
      payment: { method: "cash", cashAmount: 10000 },
      ...overrides,
    });
    const place = (body: object = cart()) =>
      request(f.server).post(`/api/public/restaurants/${restaurant.slug}/delivery-orders`).send(body);
    const order = async (body: object = cart()) => (await place(body).expect(201)).body as CreatedOrder;
    const staffOrders = async () => (await owner.agent.get(`${base}/orders`).expect(200)).body as OrderView[];
    const status = (orderId: string, body: object, agent = owner.agent, path = "orders") =>
      agent.post(`${base}/${path}/${orderId}/status`).send(body);

    return { owner, restaurant, base, providencia, nunoa, cart, place, order, staffOrders, status };
  }

  async function receiptJob(orderId: string): Promise<ReceiptJob | undefined> {
    const queue = new Queue<ReceiptJob>(QUEUES.PDF, { connection: { url: ctx.valkeyUrl } });
    try {
      const jobs = await queue.getJobs(["waiting", "delayed", "prioritized"], 0, -1, true);
      return jobs.find((job) => job.name === "receipt" && job.data.orderId === orderId)?.data;
    } finally {
      await queue.close();
    }
  }

  const lookup = async (accessToken: string) =>
    (await request(f.server).post("/api/public/orders/lookup").send({ accessToken }).expect(200)).body as PublicOrderView;

  it("publishes the active zones with the restaurant's own commune first", async () => {
    const s = await setup();
    await s.owner.agent.patch(`${s.base}/delivery-zones/${s.providencia.id}`).send({ active: false }).expect(200);
    await s.owner.agent
      .post(`${s.base}/delivery-zones`)
      .send({ name: "La Reina", fee: 2000, minOrder: 0 })
      .expect(201);

    const zones = (await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/delivery-zones`).expect(200))
      .body as PublicDeliveryZone[];
    const menu = (await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/menu`).expect(200))
      .body as PublicMenu;

    expect(zones.map((z) => [z.name, z.isHome])).toEqual([
      ["Ñuñoa", true],
      ["La Reina", false],
    ]);
    expect(menu.restaurant.deliveryEnabled).toBe(true);
  });

  it("keeps a single home zone", async () => {
    const s = await setup();

    await s.owner.agent.patch(`${s.base}/delivery-zones/${s.providencia.id}`).send({ isHome: true }).expect(200);

    const zones = (await s.owner.agent.get(`${s.base}/delivery-zones`).expect(200)).body as DeliveryZoneView[];
    expect(zones.filter((z) => z.isHome).map((z) => z.name)).toEqual(["Providencia"]);
  });

  it("only lets the owner manage zones", async () => {
    const s = await setup();
    const cashier = await f.staff(s.owner.agent, s.restaurant.id, ["cashier"]);

    await cashier.agent.get(`${s.base}/delivery-zones`).expect(200);
    await cashier.agent.post(`${s.base}/delivery-zones`).send({ name: "X", fee: 0, minOrder: 0 }).expect(403);
  });

  it("hides the zones of restaurants that do not deliver", async () => {
    const s = await setup({ deliveryEnabled: false });

    await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/delivery-zones`).expect(404);
    expect((await s.place().expect(409)).body.code).toBe("DELIVERY_DISABLED");
  });

  it("adds the zone fee to the total and shows the change the rider must bring", async () => {
    const s = await setup();

    const { accessToken, order } = await s.order();

    expect(order).toMatchObject({
      channel: "delivery",
      subtotal: 6980,
      deliveryFee: 1500,
      total: 8480,
      delivery: { zoneName: "Ñuñoa", address: "Av. Grecia 1234", unit: "Depto 5", reference: "Portón verde" },
      expectedPayment: { method: "cash", cashAmount: 10000, change: 1520 },
      riderName: null,
    });
    expect((await s.staffOrders())[0]).toMatchObject({ customerPhone: "+56912345678", rider: null, deliveryFee: 1500 });
    expect((await lookup(accessToken)).total).toBe(8480);
  });

  it.each([
    ["a subtotal below the zone minimum", "providencia", {}, 409, "BELOW_MINIMUM_ORDER"],
    ["cash that does not cover the total", "nunoa", { payment: { method: "cash", cashAmount: 8000 } }, 400, "CASH_AMOUNT_TOO_LOW"],
    ["a missing address", "nunoa", { address: "" }, 400, "VALIDATION_FAILED"],
  ] as const)("rejects %s", async (_, zoneKey, overrides, statusCode, code) => {
    const s = await setup();
    const zoneId = zoneKey === "providencia" ? s.providencia.id : s.nunoa.id;
    const body = s.cart({
      delivery: {
        zoneId,
        address: "address" in overrides ? overrides.address : "Av. Grecia 1234",
      },
      ...("payment" in overrides ? { payment: overrides.payment } : {}),
    });

    expect((await s.place(body).expect(statusCode)).body.code).toBe(code);
  });

  it("rejects zones that are inactive or belong to another restaurant", async () => {
    const s = await setup();
    const other = await setup();
    await s.owner.agent.patch(`${s.base}/delivery-zones/${s.nunoa.id}`).send({ active: false }).expect(200);

    expect((await s.place().expect(409)).body.code).toBe("ZONE_NOT_AVAILABLE");
    const foreign = s.cart({ delivery: { zoneId: other.nunoa.id, address: "Av. Grecia 1234" } });
    expect((await s.place(foreign).expect(409)).body.code).toBe("ZONE_NOT_AVAILABLE");
  });

  it("asks for an arrival time and puts the delivery data on the receipt", async () => {
    const s = await setup();
    await s.order();
    const [order] = await s.staffOrders();

    expect((await s.status(order!.id, { status: "accepted", readyInMinutes: 10 }).expect(400)).body.code).toBe(
      "READY_TIME_REQUIRED",
    );
    const accepted = (await s.status(order!.id, { status: "accepted", readyInMinutes: 45 }).expect(200)).body as OrderView;

    expect(new Date(accepted.estimatedReadyAt!).getTime()).toBeGreaterThan(Date.now() + 44 * 60_000);
    expect((await receiptJob(order!.id))?.receipt).toMatchObject({
      channel: "delivery",
      deliveryFee: 1500,
      delivery: { zoneName: "Ñuñoa" },
      expectedPayment: { change: 1520 },
    });
  });

  it("assigns a rider, who sees only their deliveries, takes it out, collects and delivers", async () => {
    const s = await setup();
    const rider = await f.staff(s.owner.agent, s.restaurant.id, ["rider"]);
    const cook = await f.staff(s.owner.agent, s.restaurant.id, ["kitchen"]);
    const { accessToken } = await s.order();
    await s.order(s.cart({ customerPhone: "9 8765 4321" }));
    const [order, other] = await s.staffOrders();

    const riders = (await s.owner.agent.get(`${s.base}/riders`).expect(200)).body as RiderView[];
    expect(riders).toHaveLength(1);
    const cookId = (await cook.agent.get("/api/auth/me").expect(200)).body.id as string;
    expect((await s.owner.agent.put(`${s.base}/orders/${order!.id}/rider`).send({ riderId: cookId }).expect(400)).body.code).toBe(
      "NOT_A_RIDER",
    );
    await s.owner.agent.put(`${s.base}/orders/${order!.id}/rider`).send({ riderId: riders[0]!.id }).expect(200);
    expect((await lookup(accessToken)).riderName).toBe(riders[0]!.name.split(" ")[0]);

    const mine = (await rider.agent.get(`${s.base}/deliveries`).expect(200)).body as OrderView[];
    expect(mine.map((o) => o.id)).toEqual([order!.id]);
    await rider.agent.get(`${s.base}/orders`).expect(403);

    await s.status(order!.id, { status: "accepted", readyInMinutes: 30 }).expect(200);
    // Riders cannot do the kitchen's steps, nor touch deliveries of others.
    expect((await s.status(order!.id, { status: "preparing" }, rider.agent, "deliveries").expect(403)).body.code).toBe(
      "FORBIDDEN_ROLE",
    );
    await s.status(order!.id, { status: "preparing" }).expect(200);
    await s.status(order!.id, { status: "ready" }).expect(200);
    expect((await s.status(other!.id, { status: "accepted" }, rider.agent, "deliveries").expect(403)).body.code).toBe(
      "NOT_YOUR_DELIVERY",
    );

    await s.status(order!.id, { status: "out_for_delivery" }, rider.agent, "deliveries").expect(200);
    expect((await lookup(accessToken)).status).toBe("out_for_delivery");
    await rider.agent.post(`${s.base}/deliveries/${order!.id}/payment`).send({ method: "cash" }).expect(200);
    const delivered = (await s.status(order!.id, { status: "delivered" }, rider.agent, "deliveries").expect(200))
      .body as OrderView;

    expect(delivered).toMatchObject({ status: "delivered", paymentStatus: "paid", paymentMethod: "cash" });
    expect((await rider.agent.get(`${s.base}/deliveries`).expect(200)).body).toEqual([]);
    await rider.agent.post(`${s.base}/deliveries/${other!.id}/payment`).send({ method: "cash" }).expect(403);
  });

  it("lets the floor staff dispatch deliveries without a rider", async () => {
    const s = await setup();
    await s.order();
    const [order] = await s.staffOrders();

    for (const body of [
      { status: "accepted", readyInMinutes: 20 },
      { status: "preparing" },
      { status: "ready" },
      { status: "out_for_delivery" },
      { status: "delivered" },
    ]) {
      await s.status(order!.id, body).expect(200);
    }
    expect((await s.owner.agent.put(`${s.base}/orders/${order!.id}/rider`).send({ riderId: null }).expect(404)).body.code).toBe(
      "ORDER_NOT_FOUND",
    );
  });
});
