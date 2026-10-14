import { randomUUID } from "node:crypto";
import {
  type CreatedOrder,
  type EditOrderItemsInput,
  type ModifierGroupView,
  type OrderView,
  type ProductView,
  type PublicOrderView,
  QUEUES,
  type ReceiptJob,
} from "@app/types";
import { Queue } from "bullmq";
import request from "supertest";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, type TestContext } from "./support/test-app";

describe("Editing an order's items (e2e)", () => {
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

  /** Owner + open restaurant with pickup + one product with a required size, and one pickup order of 2 units. */
  async function setup() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Completos Don Pepe");
    const base = `/api/restaurants/${restaurant.id}`;
    await owner.agent.patch(base).send({ phone: "+56 2 2345 6789", pickupEnabled: true }).expect(200);
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

    const line = (quantity: number) => ({
      productId: completo.id,
      quantity,
      modifiers: [{ groupId: size.id, optionIds: [size.options[0]!.id] }],
    });
    const { accessToken } = (
      await request(f.server)
        .post(`/api/public/restaurants/${restaurant.slug}/orders`)
        .send({ clientOrderId: randomUUID(), customerName: "Berta", customerPhone: "9 1234 5678", items: [line(2)] })
        .expect(201)
    ).body as CreatedOrder;
    const [order] = (await owner.agent.get(`${base}/orders`).expect(200)).body as OrderView[];
    const status = (body: object) => owner.agent.post(`${base}/orders/${order!.id}/status`).send(body);
    const edit = (body: EditOrderItemsInput, agent = owner.agent) =>
      agent.put(`${base}/orders/${order!.id}/items`).send(body);

    return { owner, restaurant, base, order: order!, accessToken, line, status, edit };
  }

  /** The receipt job of one revision of an order (no workers run in the api e2e tests). */
  async function receiptJob(orderId: string, revision: number): Promise<ReceiptJob | undefined> {
    const queue = new Queue<ReceiptJob>(QUEUES.PDF, { connection: { url: ctx.valkeyUrl } });
    try {
      const jobs = await queue.getJobs(["waiting", "delayed", "prioritized"], 0, -1, true);
      return jobs.find((job) => job.name === "receipt" && job.data.orderId === orderId && job.data.revision === revision)
        ?.data;
    } finally {
      await queue.close();
    }
  }

  const lookup = async (accessToken: string) =>
    (await request(f.server).post("/api/public/orders/lookup").send({ accessToken }).expect(200)).body as PublicOrderView;

  it("edits an accepted pickup order: new total, revision, history and a new receipt", async () => {
    const s = await setup();
    await s.status({ status: "accepted", readyInMinutes: 15 }).expect(200);

    const edited = (
      await s.edit({ revision: 0, keep: [{ line: 0, quantity: 2 }], add: [s.line(1)], reason: " Llamó  la clienta " }).expect(200)
    ).body as OrderView;

    expect(edited).toMatchObject({
      status: "accepted",
      subtotal: 3490 * 3,
      total: 3490 * 3,
      revision: 1,
      edits: [{ byName: "Dueña", reason: "Llamó la clienta", changes: ["+1 Completo italiano (Normal)"] }],
    });
    expect(edited.items.map((item) => item.quantity)).toEqual([2, 1]);
    const tracking = await lookup(s.accessToken);
    expect(tracking.total).toBe(3490 * 3);
    expect(tracking.editedAt).toBe(edited.edits[0]!.at);
    expect(tracking).not.toHaveProperty("edits");

    expect(await receiptJob(s.order.id, 1)).toMatchObject({
      outputKey: `restaurants/${s.restaurant.id}/receipts/${s.order.id}-r1.pdf`,
      receipt: { total: 3490 * 3 },
      email: null,
    });
    expect((await s.owner.agent.get(`${s.base}/orders/${s.order.id}/receipt`).expect(202)).body).toEqual({ status: "pending" });
  });

  it("removes lines and changes quantities, but never leaves the order empty or unchanged", async () => {
    const s = await setup();

    expect((await s.edit({ revision: 0, keep: [], add: [] }).expect(400)).body.code).toBe("ORDER_EMPTY");
    expect((await s.edit({ revision: 0, keep: [{ line: 0, quantity: 2 }], add: [] }).expect(400)).body.code).toBe(
      "NOTHING_CHANGED",
    );
    expect((await s.edit({ revision: 0, keep: [{ line: 3, quantity: 1 }], add: [] }).expect(400)).body.code).toBe(
      "INVALID_EDIT",
    );
    const fewer = (await s.edit({ revision: 0, keep: [{ line: 0, quantity: 1 }], add: [] }).expect(200)).body as OrderView;
    expect(fewer).toMatchObject({ total: 3490, edits: [{ changes: ["Completo italiano (Normal): 2 → 1"] }] });
  });

  it("refuses edits once the kitchen started the order", async () => {
    const s = await setup();
    await s.status({ status: "accepted", readyInMinutes: 15 }).expect(200);
    await s.status({ status: "preparing" }).expect(200);

    const res = await s.edit({ revision: 0, keep: [{ line: 0, quantity: 1 }], add: [] }).expect(409);

    expect(res.body.code).toBe("ORDER_NOT_EDITABLE");
  });

  it("refuses an edit made on an old revision", async () => {
    const s = await setup();
    await s.edit({ revision: 0, keep: [{ line: 0, quantity: 1 }], add: [] }).expect(200);

    const res = await s.edit({ revision: 0, keep: [{ line: 0, quantity: 3 }], add: [] }).expect(409);

    expect(res.body.code).toBe("ORDER_CHANGED");
  });

  it("is not open to riders, nor to waiters on pickup orders", async () => {
    const s = await setup();
    const rider = await f.staff(s.owner.agent, s.restaurant.id, ["rider"]);
    const waiter = await f.staff(s.owner.agent, s.restaurant.id, ["waiter"]);
    const body = { revision: 0, keep: [{ line: 0, quantity: 1 }], add: [] };

    expect((await s.edit(body, rider.agent).expect(403)).body.code).toBe("FORBIDDEN_ROLE");
    expect((await s.edit(body, waiter.agent).expect(403)).body.code).toBe("FORBIDDEN_ROLE");
  });
});
