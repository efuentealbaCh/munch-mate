import { randomUUID } from "node:crypto";
import {
  type CreatedOrder,
  type CustomerOrdersPage,
  type NotifJob,
  type OrderView,
  type PublicOrderView,
  QUEUES,
  type SavedAddressView,
  type TableView,
  type UserProfile,
} from "@app/types";
import { Queue } from "bullmq";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, type TestContext } from "./support/test-app";

const FCM = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/test-${n}-${randomUUID()}`,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
});

describe("Customer accounts and web push (e2e)", () => {
  let ctx: TestContext;
  let f: ReturnType<typeof fixtures>;

  beforeAll(async () => {
    // Push configured: the api only needs the public key (the private one lives in the workers).
    process.env.VAPID_PUBLIC_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
    ctx = await createTestApp();
    f = fixtures(ctx);
  });

  beforeEach(async () => {
    await resetRateLimits(ctx.valkeyUrl);
  });

  afterAll(async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    await ctx?.close();
  });

  /** Open restaurant with a $3.490 product and a table; returns how to order from it (optionally signed in). */
  async function restaurantWithTable() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Completos Don Pepe");
    const base = `/api/restaurants/${restaurant.id}`;
    const category = (await owner.agent.post(`${base}/menu/categories`).send({ name: "Completos" }).expect(201)).body;
    const product = (
      await owner.agent.post(`${base}/menu/products`).send({ categoryId: category.id, name: "Completo", price: 3490 }).expect(201)
    ).body as { id: string };
    const table = (await owner.agent.post(`${base}/tables`).send({ label: "Mesa 1" }).expect(201)).body as TableView;
    await owner.agent.put(`${base}/accepting-orders`).send({ acceptingOrders: true }).expect(200);
    const order = async (agent?: TestAgent) =>
      (
        await (agent ?? request(f.server))
          .post(`/api/public/tables/${table.token}/orders`)
          .send({ clientOrderId: randomUUID(), items: [{ productId: product.id, quantity: 2, modifiers: [] }] })
          .expect(201)
      ).body as CreatedOrder;
    return { owner, restaurant, base, order };
  }

  async function notifJobs(): Promise<NotifJob[]> {
    const queue = new Queue<NotifJob>(QUEUES.NOTIF, { connection: { url: ctx.valkeyUrl } });
    try {
      return (await queue.getJobs(["waiting", "delayed", "prioritized"], 0, -1, true)).map((job) => job.data);
    } finally {
      await queue.close();
    }
  }

  describe("profile and saved addresses", () => {
    it("saves the phone normalized and shows it in /auth/me", async () => {
      const customer = await f.user({ name: "Berta" });

      const profile = (await customer.agent.patch("/api/me").send({ phone: "9 1234 5678" }).expect(200)).body as UserProfile;

      expect(profile.phone).toBe("+56912345678");
      expect((await customer.agent.get("/api/auth/me").expect(200)).body.phone).toBe("+56912345678");
      expect((await customer.agent.patch("/api/me").send({ phone: "abc" }).expect(400)).body.code).toBe("INVALID_PHONE");
      await request(f.server).patch("/api/me").send({ name: "X" }).expect(401);
    });

    it("keeps each customer's addresses private", async () => {
      const ana = await f.user({ name: "Ana" });
      const beto = await f.user({ name: "Beto" });

      const casa = (
        await ana.agent
          .post("/api/me/addresses")
          .send({ label: "Casa", address: "Av. Grecia 1234", unit: "Depto 5", location: { lat: -33.456, lng: -70.59 } })
          .expect(201)
      ).body as SavedAddressView;

      expect(casa).toMatchObject({ label: "Casa", unit: "Depto 5", location: { lat: -33.456, lng: -70.59 } });
      expect((await ana.agent.post("/api/me/addresses").send({ label: "CASA", address: "Otra 1" }).expect(409)).body.code).toBe(
        "ADDRESS_LABEL_TAKEN",
      );
      expect((await beto.agent.get("/api/me/addresses").expect(200)).body).toEqual([]);
      await beto.agent.delete(`/api/me/addresses/${casa.id}`).expect(404);
      await beto.agent.put(`/api/me/addresses/${casa.id}`).send({ label: "Mía", address: "Calle 1" }).expect(404);

      const moved = (await ana.agent.put(`/api/me/addresses/${casa.id}`).send({ label: "Casa", address: "Av. Grecia 1300" }).expect(200))
        .body as SavedAddressView;
      expect(moved).toMatchObject({ address: "Av. Grecia 1300", location: null });
      await ana.agent.delete(`/api/me/addresses/${casa.id}`).expect(204);
    });
  });

  describe("order history", () => {
    it("lists only the signed-in customer's orders, with a token that opens their tracking", async () => {
      const r = await restaurantWithTable();
      const customer = await f.user({ name: "Clara" });
      const mine = await r.order(customer.agent);
      await r.order(); // a guest's order

      const page = (await customer.agent.get("/api/me/orders").expect(200)).body as CustomerOrdersPage;

      expect(page.nextBefore).toBeNull();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        trackingToken: mine.accessToken,
        restaurant: { name: "Completos Don Pepe", slug: r.restaurant.slug },
        channel: "dine_in",
        total: 6980,
        itemCount: 2,
      });
      const tracked = (await request(f.server).post("/api/public/orders/lookup").send({ accessToken: page.items[0]!.trackingToken }).expect(200))
        .body as PublicOrderView;
      expect(tracked.number).toBe(mine.order.number);
      await customer.agent.get("/api/me/orders?before=no-es-fecha").expect(400);
      await request(f.server).get("/api/me/orders").expect(401);
    });
  });

  describe("web push", () => {
    it("publishes the public key and only accepts real push services", async () => {
      expect((await request(f.server).get("/api/public/push-config").expect(200)).body.publicKey).toMatch(/^BEl6/);
      const user = await f.user();

      await user.agent.post("/api/me/push-subscriptions").send(FCM(1)).expect(204);
      const bad = { ...FCM(2), endpoint: "https://valkey:6379/x" };
      expect((await user.agent.post("/api/me/push-subscriptions").send(bad).expect(400)).body.code).toBe("INVALID_PUSH_ENDPOINT");
      await request(f.server).post("/api/me/push-subscriptions").send(FCM(3)).expect(401);
    });

    it("notifies the board staff of a new order, and lets a guest follow it until it ends", async () => {
      const r = await restaurantWithTable();
      const staffDevice = FCM(10);
      await r.owner.agent.post("/api/me/push-subscriptions").send(staffDevice).expect(204);

      const { accessToken } = await r.order();
      const [order] = (await r.owner.agent.get(`${r.base}/orders`).expect(200)).body as OrderView[];
      const created = (await notifJobs()).find((job) => job.notification.tag === `order-${order!.id}`);
      expect(created?.subscriptions.map((s) => s.endpoint)).toEqual([staffDevice.endpoint]);
      expect(created?.notification).toMatchObject({ title: `Pedido nuevo #${order!.ticketNumber}`, url: `/admin/${r.restaurant.id}/pedidos` });

      // A guest follows the order; finished orders cannot be followed.
      const guestDevice = FCM(11);
      await request(f.server).post("/api/public/orders/push-subscription").send({ accessToken, subscription: guestDevice }).expect(204);
      for (const status of ["accepted", "preparing", "ready", "served"]) {
        await r.owner.agent.post(`${r.base}/orders/${order!.id}/status`).send({ status }).expect(200);
      }
      const followAgain = await request(f.server)
        .post("/api/public/orders/push-subscription")
        .send({ accessToken, subscription: FCM(12) })
        .expect(409);
      expect(followAgain.body.code).toBe("ORDER_FINISHED");
    });

    it("lets a user turn notifications off on a device", async () => {
      const user = await f.user();
      const device = FCM(20);
      await user.agent.post("/api/me/push-subscriptions").send(device).expect(204);

      await user.agent.delete("/api/me/push-subscriptions").send({ endpoint: device.endpoint }).expect(204);
    });
  });
});
