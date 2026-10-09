import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  type CreatedOrder,
  type ModifierGroupView,
  type OrderView,
  type ProductView,
  type PublicMenu,
  type PublicOrderView,
  QUEUES,
  type ReceiptJob,
  type TableView,
} from "@app/types";
import { Queue } from "bullmq";
import request from "supertest";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, TEST_APP_URL, type TestContext } from "./support/test-app";

describe("Pickup orders (e2e)", () => {
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

  /** Owner + open restaurant with pickup enabled + one product with a required size. */
  async function setup(options: { pickupEnabled?: boolean } = {}) {
    const { owner, restaurant } = await f.ownerWithRestaurant("Completos Don Pepe");
    const base = `/api/restaurants/${restaurant.id}`;
    await owner.agent.patch(base).send({ phone: "+56 2 2345 6789", pickupEnabled: options.pickupEnabled ?? true }).expect(200);
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

    const cart = (overrides: object = {}) => ({
      clientOrderId: randomUUID(),
      customerName: "Berta",
      customerPhone: "9 1234 5678",
      customerEmail: "Berta@Example.com",
      items: [{ productId: completo.id, quantity: 2, modifiers: [{ groupId: size.id, optionIds: [size.options[0]!.id] }] }],
      ...overrides,
    });
    const place = (body: object = cart()) =>
      request(f.server).post(`/api/public/restaurants/${restaurant.slug}/orders`).send(body);
    const order = async (body: object = cart()) => (await place(body).expect(201)).body as CreatedOrder;
    const staffOrders = async () => (await owner.agent.get(`${base}/orders`).expect(200)).body as OrderView[];

    return { owner, restaurant, base, cart, place, order, staffOrders };
  }

  /** Jobs waiting in the pdf queue for one order (no workers run in the api e2e tests). */
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

  it("tells the public menu whether pickup orders can be placed", async () => {
    const s = await setup();

    const menu = (await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/menu`).expect(200))
      .body as PublicMenu;

    expect(menu.restaurant).toMatchObject({ acceptingOrders: true, pickupEnabled: true });
  });

  it("places a pickup order with normalized contact data, priced on the server", async () => {
    const s = await setup();

    const { accessToken, order } = await s.order();

    expect(order).toMatchObject({
      channel: "pickup",
      status: "pending",
      total: 3490 * 2,
      tableLabel: null,
      estimatedReadyAt: null,
      receiptAvailable: false,
      restaurant: { name: "Completos Don Pepe", slug: s.restaurant.slug, phone: "+56223456789" },
    });
    const [staffView] = await s.staffOrders();
    expect(staffView).toMatchObject({
      channel: "pickup",
      customerName: "Berta",
      customerPhone: "+56912345678",
      customerEmail: "berta@example.com",
    });
    expect((await lookup(accessToken)).channel).toBe("pickup");
  });

  it("is idempotent per clientOrderId", async () => {
    const s = await setup();
    const body = s.cart();

    const first = await s.order(body);
    const second = await s.order(body);

    expect(second.accessToken).toBe(first.accessToken);
    expect(await s.staffOrders()).toHaveLength(1);
  });

  it.each([
    ["an invalid phone", { customerPhone: "123" }, 400, "INVALID_PHONE"],
    ["a missing name", { customerName: "" }, 400, "VALIDATION_FAILED"],
    ["an invalid email", { customerEmail: "berta@" }, 400, "VALIDATION_FAILED"],
  ])("rejects %s", async (_, overrides, status, code) => {
    const s = await setup();

    const res = await s.place(s.cart(overrides)).expect(status);

    expect(res.body.code).toBe(code);
  });

  it("accepts orders without an email", async () => {
    const s = await setup();

    await s.order(s.cart({ customerEmail: undefined }));

    expect((await s.staffOrders())[0]!.customerEmail).toBe("");
  });

  it("refuses orders when the owner has not enabled pickup, or the restaurant is closed", async () => {
    const disabled = await setup({ pickupEnabled: false });
    expect((await disabled.place().expect(409)).body.code).toBe("PICKUP_DISABLED");

    const closed = await setup();
    await closed.owner.agent.put(`${closed.base}/accepting-orders`).send({ acceptingOrders: false }).expect(200);
    expect((await closed.place().expect(409)).body.code).toBe("NOT_ACCEPTING_ORDERS");

    await request(f.server).post("/api/public/restaurants/no-existe/orders").send(closed.cart()).expect(404);
  });

  it("caps the orders in progress per phone, however the phone is written", async () => {
    const s = await setup();
    for (const phone of ["912345678", "+56 9 1234 5678", "(+56) 9-1234-5678"]) {
      await s.order(s.cart({ customerPhone: phone }));
    }

    const res = await s.place(s.cart({ customerPhone: "9 1234 5678" })).expect(429);

    expect(res.body.code).toBe("TOO_MANY_ACTIVE_ORDERS");
    await s.order(s.cart({ customerPhone: "9 8765 4321" }));
  });

  it("frees the per-phone limit once orders are finished", async () => {
    const s = await setup();
    const placed = [];
    for (let i = 0; i < 3; i++) placed.push(await s.order());
    const [first] = await s.staffOrders();
    await s.owner.agent
      .post(`${s.base}/orders/${first!.id}/status`)
      .send({ status: "rejected", reason: "Sin stock" })
      .expect(200);

    await s.order();
  });

  it("asks for a ready time when accepting and sends it to the customer with a receipt", async () => {
    const s = await setup();
    const { accessToken } = await s.order();
    const [order] = await s.staffOrders();
    const status = (body: object) => s.owner.agent.post(`${s.base}/orders/${order!.id}/status`).send(body);

    expect((await status({ status: "accepted" }).expect(400)).body.code).toBe("READY_TIME_REQUIRED");
    expect((await status({ status: "accepted", readyInMinutes: 7 }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    const before = Date.now();
    const accepted = (await status({ status: "accepted", readyInMinutes: 20 }).expect(200)).body as OrderView;

    const readyAt = new Date(accepted.estimatedReadyAt!).getTime();
    expect(readyAt).toBeGreaterThanOrEqual(before + 20 * 60_000);
    expect(readyAt).toBeLessThan(Date.now() + 21 * 60_000);
    expect(accepted.receiptAvailable).toBe(true);
    expect(await lookup(accessToken)).toMatchObject({ estimatedReadyAt: accepted.estimatedReadyAt, receiptAvailable: true });

    const job = await receiptJob(order!.id);
    expect(job).toMatchObject({
      outputKey: `restaurants/${s.restaurant.id}/receipts/${order!.id}.pdf`,
      receipt: { customerPhone: "+56912345678", total: 6980, timezone: "America/Santiago" },
      email: { to: "berta@example.com", trackingUrl: `${TEST_APP_URL}/pedido#t=${accessToken}` },
    });
  });

  it("serves the receipt to the staff and the customer once the workers stored it", async () => {
    const s = await setup();
    const { accessToken } = await s.order();
    const [order] = await s.staffOrders();
    const staffReceipt = () => s.owner.agent.get(`${s.base}/orders/${order!.id}/receipt`);
    const customerReceipt = () => request(f.server).post("/api/public/orders/receipt").send({ accessToken });

    expect((await customerReceipt().expect(404)).body.code).toBe("RECEIPT_NOT_FOUND");
    await s.owner.agent
      .post(`${s.base}/orders/${order!.id}/status`)
      .send({ status: "accepted", readyInMinutes: 15 })
      .expect(200);
    expect((await staffReceipt().expect(202)).body).toEqual({ status: "pending" });

    // Play the worker's part: store the PDF at the key the job asked for.
    const job = (await receiptJob(order!.id))!;
    const s3 = new S3Client({
      endpoint: ctx.garage.env.S3_ENDPOINT,
      region: ctx.garage.env.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: ctx.garage.env.S3_ACCESS_KEY_ID,
        secretAccessKey: ctx.garage.env.S3_SECRET_ACCESS_KEY,
      },
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: ctx.garage.env.S3_BUCKET,
        Key: job.outputKey,
        Body: Buffer.from("%PDF-1.7 test"),
        ContentType: "application/pdf",
      }),
    );
    s3.destroy();

    for (const res of [await staffReceipt().expect(200), await customerReceipt().expect(200)]) {
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["content-disposition"]).toBe(`attachment; filename="comprobante-pedido-${job.receipt.number}.pdf"`);
    }
  });

  it("goes from accepted to picked up, even before the payment is registered", async () => {
    const s = await setup();
    const { accessToken } = await s.order();
    const [order] = await s.staffOrders();
    const status = (body: object) => s.owner.agent.post(`${s.base}/orders/${order!.id}/status`).send(body);

    await status({ status: "accepted", readyInMinutes: 10 }).expect(200);
    await status({ status: "preparing" }).expect(200);
    await status({ status: "ready" }).expect(200);
    expect((await status({ status: "served" }).expect(409)).body.code).toBe("INVALID_TRANSITION");
    const done = (await status({ status: "picked_up" }).expect(200)).body as OrderView;

    expect(done).toMatchObject({ status: "picked_up", paymentStatus: "unpaid" });
    expect((await lookup(accessToken)).status).toBe("picked_up");
    expect(await s.staffOrders()).toEqual([]);
  });

  it("never offers receipts for dine-in orders", async () => {
    const s = await setup();
    const table = (await s.owner.agent.post(`${s.base}/tables`).send({ label: "Mesa 1" }).expect(201)).body as TableView;
    const { productId, modifiers } = s.cart().items[0]!;
    await request(f.server)
      .post(`/api/public/tables/${table.token}/orders`)
      .send({ clientOrderId: randomUUID(), items: [{ productId, quantity: 1, modifiers }] })
      .expect(201);
    const [order] = await s.staffOrders();

    await s.owner.agent.post(`${s.base}/orders/${order!.id}/status`).send({ status: "accepted" }).expect(200);

    expect((await s.owner.agent.get(`${s.base}/orders/${order!.id}/receipt`).expect(404)).body.code).toBe(
      "RECEIPT_NOT_FOUND",
    );
    expect(await receiptJob(order!.id)).toBeUndefined();
  });
});
