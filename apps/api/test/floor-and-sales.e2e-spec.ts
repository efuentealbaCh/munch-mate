import { randomUUID } from "node:crypto";
import {
  type CreatedOrder,
  type DailySummary,
  type MessageJob,
  type OrderView,
  type ProductView,
  type PublicMenu,
  type PublicTableBill,
  QUEUES,
  type RestaurantView,
  type SalesReport,
  type TableSessionView,
  type TableView,
} from "@app/types";
import { localDate } from "@app/utils";
import { Queue } from "bullmq";
import request from "supertest";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, type TestContext } from "./support/test-app";

const TZ = "America/Santiago";

/**
 * Phase 8 end to end: product discounts, the waiter role, table accounts (call the waiter, ask for the bill,
 * charge with a tip), sales between dates with CSV exports, and WhatsApp/SMS notices reaching the queue.
 */
describe("Phase 8: floor, discounts, sales export and notices (e2e)", () => {
  let ctx: TestContext;
  let f: ReturnType<typeof fixtures>;
  const previousProvider = process.env.MESSAGING_PROVIDER;

  beforeAll(async () => {
    // The api offers notices only with a provider configured (the workers would deliver them to Mailpit).
    process.env.MESSAGING_PROVIDER = "mailpit";
    ctx = await createTestApp();
    f = fixtures(ctx);
  });

  beforeEach(async () => {
    await resetRateLimits(ctx.valkeyUrl);
  });

  afterAll(async () => {
    await ctx?.close();
    if (previousProvider === undefined) delete process.env.MESSAGING_PROVIDER;
    else process.env.MESSAGING_PROVIDER = previousProvider;
  });

  /** Open restaurant (pickup on) with a $10.000 product, a table, and helpers to order. */
  async function setup() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Trattoria Ocho");
    const base = `/api/restaurants/${restaurant.id}`;
    const category = (await owner.agent.post(`${base}/menu/categories`).send({ name: "Pastas" }).expect(201)).body;
    const pasta = (
      await owner.agent.post(`${base}/menu/products`).send({ categoryId: category.id, name: "Lasaña", price: 10000 }).expect(201)
    ).body as ProductView;
    const table = (await owner.agent.post(`${base}/tables`).send({ label: "Mesa 8" }).expect(201)).body as TableView;
    await owner.agent.patch(base).send({ pickupEnabled: true }).expect(200);
    await owner.agent.put(`${base}/accepting-orders`).send({ acceptingOrders: true }).expect(200);
    const tableOrder = (quantity = 1) =>
      request(f.server)
        .post(`/api/public/tables/${table.token}/orders`)
        .send({ clientOrderId: randomUUID(), items: [{ productId: pasta.id, quantity, modifiers: [] }] });
    const pickupOrder = (extra: Record<string, unknown> = {}) =>
      request(f.server)
        .post(`/api/public/restaurants/${restaurant.slug}/orders`)
        .send({
          clientOrderId: randomUUID(),
          customerName: "Rita",
          customerPhone: "9 8765 4321",
          items: [{ productId: pasta.id, quantity: 1, modifiers: [] }],
          ...extra,
        });
    const activeOrders = async () => (await owner.agent.get(`${base}/orders`).expect(200)).body as OrderView[];
    const serve = async (orderId: string) => {
      for (const status of ["accepted", "preparing", "ready", "served"]) {
        await owner.agent.post(`${base}/orders/${orderId}/status`).send({ status }).expect(200);
      }
    };
    return { owner, restaurant, base, pasta, table, tableOrder, pickupOrder, activeOrders, serve };
  }

  describe("product discounts", () => {
    it("charges the discounted price, shows it on the public menu and snapshots both prices", async () => {
      const s = await setup();
      const promo = { kind: "percent", value: 20, days: [], startsOn: null, endsOn: null, label: "Martes de pasta" };
      const view = (await s.owner.agent.put(`${s.base}/menu/products/${s.pasta.id}/promo`).send(promo).expect(200))
        .body as ProductView;
      expect(view.promo).toEqual(promo);

      const menu = (await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/menu`).expect(200)).body as PublicMenu;
      expect(menu.restaurant.timezone).toBe(TZ);
      expect(menu.categories[0]!.products[0]).toMatchObject({ price: 10000, promo });

      const created = (await s.tableOrder(2).expect(201)).body as CreatedOrder;
      expect(created.order.total).toBe(16000);
      expect(created.order.items[0]).toMatchObject({ unitPrice: 8000, regularUnitPrice: 10000, promoLabel: "Martes de pasta" });

      await s.owner.agent.delete(`${s.base}/menu/products/${s.pasta.id}/promo`).expect(200);
      expect(((await s.tableOrder().expect(201)).body as CreatedOrder).order.total).toBe(10000);
    });

    it("validates discounts and lets only the owner set them", async () => {
      const s = await setup();
      const res = await s.owner.agent
        .put(`${s.base}/menu/products/${s.pasta.id}/promo`)
        .send({ kind: "price", value: 12000 })
        .expect(400);
      expect(res.body).toMatchObject({ code: "INVALID_PROMO", meta: { problem: "price_not_lower" } });
      await s.owner.agent.put(`${s.base}/menu/products/${s.pasta.id}/promo`).send({ kind: "percent", value: 20, days: [8] }).expect(400);
      const cashier = await f.staff(s.owner.agent, s.restaurant.id, ["cashier"]);
      await cashier.agent.put(`${s.base}/menu/products/${s.pasta.id}/promo`).send({ kind: "percent", value: 10 }).expect(403);
    });
  });

  describe("waiters", () => {
    it("work and charge table orders, but not pickup orders, sales or the menu", async () => {
      const s = await setup();
      const waiter = await f.staff(s.owner.agent, s.restaurant.id, ["waiter"]);
      await s.tableOrder().expect(201);
      await s.pickupOrder().expect(201);
      const [dineIn, pickup] = ((await waiter.agent.get(`${s.base}/orders`).expect(200)).body as OrderView[]).sort((a) =>
        a.channel === "dine_in" ? -1 : 1,
      );

      await waiter.agent.post(`${s.base}/orders/${dineIn!.id}/status`).send({ status: "accepted" }).expect(200);
      await waiter.agent.post(`${s.base}/orders/${dineIn!.id}/payment`).send({ method: "cash" }).expect(200);
      expect(
        (await waiter.agent.post(`${s.base}/orders/${pickup!.id}/status`).send({ status: "accepted", readyInMinutes: 15 }).expect(403)).body
          .code,
      ).toBe("FORBIDDEN_ROLE");
      await waiter.agent.post(`${s.base}/orders/${pickup!.id}/payment`).send({ method: "cash" }).expect(403);
      await waiter.agent.get(`${s.base}/reports/daily`).expect(403);
      await waiter.agent.get(`${s.base}/table-sessions`).expect(200);
      await waiter.agent.get(`${s.base}/tables`).expect(200);

      const cook = await f.staff(s.owner.agent, s.restaurant.id, ["kitchen"]);
      await cook.agent.get(`${s.base}/table-sessions`).expect(403);
    });
  });

  describe("table accounts", () => {
    it("adds up the table's orders, calls the waiter, asks for the bill and charges it with the tip", async () => {
      const s = await setup();
      const bill = () => request(f.server).get(`/api/public/tables/${s.table.token}/bill`).expect(200);

      expect(((await bill()).body as PublicTableBill)).toMatchObject({ open: false, lines: [], tipPercent: 10 });
      const nothing = await request(f.server)
        .post(`/api/public/tables/${s.table.token}/request-bill`)
        .send({ tip: { kind: "suggested" } })
        .expect(409);
      expect(nothing.body.code).toBe("NOTHING_TO_PAY");

      await s.tableOrder(1).expect(201);
      await s.tableOrder(1).expect(201);
      const open = (await bill()).body as PublicTableBill;
      expect(open).toMatchObject({
        open: true,
        lines: [{ name: "Lasaña", options: [], quantity: 2, total: 20000 }],
        orderCount: 2,
        ordersInProgress: 2,
        subtotal: 20000,
        suggestedTip: 2000,
      });

      await request(f.server).post(`/api/public/tables/${s.table.token}/call-waiter`).expect(200);
      let [session] = (await s.owner.agent.get(`${s.base}/table-sessions`).expect(200)).body as TableSessionView[];
      expect(session).toMatchObject({ tableLabel: "Mesa 8", orderCount: 2, unpaidOrders: 2 });
      expect(session!.waiterCalledAt).not.toBeNull();
      session = (await s.owner.agent.post(`${s.base}/table-sessions/${session!.id}/attend`).send({ kind: "waiter" }).expect(200))
        .body as TableSessionView;
      expect(session.waiterCalledAt).toBeNull();

      const asked = (
        await request(f.server).post(`/api/public/tables/${s.table.token}/request-bill`).send({ tip: { kind: "suggested" } }).expect(200)
      ).body as PublicTableBill;
      expect(asked).toMatchObject({ requestedTip: 2000 });
      expect(asked.billRequestedAt).not.toBeNull();

      const busy = await s.owner.agent
        .post(`${s.base}/table-sessions/${session.id}/close`)
        .send({ method: "card_pos", tip: 2500 })
        .expect(409);
      expect(busy.body.code).toBe("TABLE_ORDERS_IN_PROGRESS");

      for (const order of await s.activeOrders()) await s.serve(order.id);
      const closed = (
        await s.owner.agent.post(`${s.base}/table-sessions/${session.id}/close`).send({ method: "card_pos", tip: 2500 }).expect(200)
      ).body as TableSessionView;
      expect(closed).toMatchObject({ status: "closed", tip: 2500, paymentMethod: "card_pos", unpaidOrders: 0 });
      await s.owner.agent.post(`${s.base}/table-sessions/${session.id}/close`).send({ method: "cash", tip: 0 }).expect(404);

      const paid = (await bill()).body as PublicTableBill;
      expect(paid).toMatchObject({ open: false, subtotal: 20000 });
      expect(paid.closedAt).not.toBeNull();
      const summary = (await s.owner.agent.get(`${s.base}/reports/daily`).expect(200)).body as DailySummary;
      expect(summary).toMatchObject({ tips: 2500, sales: { total: 20000, paid: 20000 } });
      expect(summary.byPaymentMethod.card_pos).toBe(20000);

      // The next order opens a new account.
      await s.tableOrder().expect(201);
      const [next] = (await s.owner.agent.get(`${s.base}/table-sessions`).expect(200)).body as TableSessionView[];
      expect(next!.id).not.toBe(session.id);
      expect(next!.orderCount).toBe(1);
    });

    it("rejects tips that make no sense and unknown tables", async () => {
      const s = await setup();
      await s.tableOrder().expect(201);
      await request(f.server)
        .post(`/api/public/tables/${s.table.token}/request-bill`)
        .send({ tip: { kind: "amount", amount: -100 } })
        .expect(400);
      await request(f.server).get("/api/public/tables/no-existe/bill").expect(404);
    });
  });

  describe("sales between dates and exports", () => {
    it("reports a range with one row per day and exports it as CSV for Excel", async () => {
      const s = await setup();
      await s.pickupOrder().expect(201);
      const today = localDate(new Date(), TZ);

      const report = (await s.owner.agent.get(`${s.base}/reports/sales`).query({ from: today, to: today }).expect(200))
        .body as SalesReport;
      expect(report).toMatchObject({ from: today, to: today, sales: { total: 10000 }, tips: 0 });
      expect(report.days).toEqual([{ date: today, orders: 1, total: 10000, tips: 0 }]);

      const csv = await s.owner.agent.get(`${s.base}/reports/sales.csv`).query({ from: today, to: today, kind: "orders" }).expect(200);
      expect(csv.headers["content-type"]).toBe("text/csv; charset=utf-8");
      expect(csv.headers["content-disposition"]).toContain(`ventas-pedidos-${s.restaurant.slug}-${today}.csv`);
      const text = csv.text ?? Buffer.from(csv.body as Buffer).toString("utf8");
      expect(text.startsWith("﻿Fecha;Hora;N° pedido")).toBe(true);
      expect(text).toContain(";Para retirar;Rita;Pendiente;Pendiente;;1;0;0;10000");

      const cashier = await f.staff(s.owner.agent, s.restaurant.id, ["cashier"]);
      await cashier.agent.get(`${s.base}/reports/sales.csv`).query({ from: today, to: today, kind: "days" }).expect(200);
      const cook = await f.staff(s.owner.agent, s.restaurant.id, ["kitchen"]);
      await cook.agent.get(`${s.base}/reports/sales`).query({ from: today, to: today }).expect(403);
    });

    it("validates the range", async () => {
      const s = await setup();
      const bad = async (query: Record<string, string>, code: string) =>
        expect((await s.owner.agent.get(`${s.base}/reports/sales`).query(query).expect(400)).body.code).toBe(code);
      await bad({ from: "2026-10-10", to: "2026-10-01" }, "INVALID_RANGE");
      await bad({ from: "2024-01-01", to: "2026-10-01" }, "RANGE_TOO_LONG");
      await bad({ from: "2026-02-30", to: "2026-03-01" }, "INVALID_DATE");
      await s.owner.agent.get(`${s.base}/reports/sales.csv`).query({ from: "2026-10-01", to: "2026-10-02", kind: "pdf" }).expect(400);
    });
  });

  describe("WhatsApp and SMS notices", () => {
    it("lets the owner set the sender, offers notices and queues them with the order events", async () => {
      const s = await setup();
      const missing = await s.owner.agent
        .patch(s.base)
        .send({ messaging: { enabled: true, channel: "whatsapp", senderPhone: "" } })
        .expect(400);
      expect(missing.body.code).toBe("SENDER_PHONE_REQUIRED");
      const view = (
        await s.owner.agent
          .patch(s.base)
          .send({ messaging: { enabled: true, channel: "whatsapp", senderPhone: "+56 9 2222 3333" } })
          .expect(200)
      ).body as RestaurantView;
      expect(view).toMatchObject({ messagingAvailable: true, messaging: { enabled: true, channel: "whatsapp", senderPhone: "+56922223333" } });
      const menu = (await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/menu`).expect(200)).body as PublicMenu;
      expect(menu.restaurant.messaging).toEqual({ channel: "whatsapp" });

      const landline = await s.pickupOrder({ customerPhone: "+56 2 2345 6789", notifyByMessage: true }).expect(400);
      expect(landline.body.code).toBe("PHONE_NOT_MOBILE");
      const created = (await s.pickupOrder({ notifyByMessage: true }).expect(201)).body as CreatedOrder;
      expect(created.order.notifyBy).toBe("whatsapp");

      const [order] = await s.activeOrders();
      await s.owner.agent.post(`${s.base}/orders/${order!.id}/status`).send({ status: "accepted", readyInMinutes: 20 }).expect(200);

      const queue = new Queue<MessageJob>(QUEUES.NOTIF, { connection: { url: ctx.valkeyUrl } });
      try {
        const job = await queue.getJob(`msg-${order!.id}-accepted`);
        expect(job?.name).toBe("message");
        expect(job?.data).toMatchObject({
          channel: "whatsapp",
          from: "+56922223333",
          to: "+56987654321",
          event: "accepted",
          text: expect.stringMatching(/^Trattoria Ocho: aceptamos tu pedido #\d+\. Estará listo a las \d{2}:\d{2}\. Síguelo en http:\/\/localhost:3100\/pedido#t=/),
        });
      } finally {
        await queue.close();
      }
    });

    it("does not offer notices until the owner turns them on", async () => {
      const s = await setup();
      const menu = (await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/menu`).expect(200)).body as PublicMenu;
      expect(menu.restaurant.messaging).toBeNull();
      const created = (await s.pickupOrder({ notifyByMessage: true, customerPhone: "+56 2 2345 6789" }).expect(201)).body as CreatedOrder;
      expect(created.order.notifyBy).toBeNull();
    });
  });
});
