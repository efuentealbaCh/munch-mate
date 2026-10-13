import { randomUUID } from "node:crypto";
import type { CreatedOrder, DailySummary, OrderView, ProductView, PublicTableBill, TableSessionView, TableView } from "@app/types";
import request from "supertest";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, type TestContext } from "./support/test-app";

/**
 * Split table accounts end to end: the staff split the bill in equal parts or by products, each payment with
 * its own method and tip; the payment that completes the bill closes the account and pays its orders with
 * their share of each method, which the daily summary reports per method.
 */
describe("Split table accounts (e2e)", () => {
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

  /** Open restaurant with a $10.000 product, a table, and helpers to order, serve and charge. */
  async function setup() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Trattoria Divisa");
    const base = `/api/restaurants/${restaurant.id}`;
    const category = (await owner.agent.post(`${base}/menu/categories`).send({ name: "Pastas" }).expect(201)).body;
    const pasta = (
      await owner.agent.post(`${base}/menu/products`).send({ categoryId: category.id, name: "Lasaña", price: 10000 }).expect(201)
    ).body as ProductView;
    const table = (await owner.agent.post(`${base}/tables`).send({ label: "Mesa 9" }).expect(201)).body as TableView;
    await owner.agent.put(`${base}/accepting-orders`).send({ acceptingOrders: true }).expect(200);
    const tableOrder = async (quantity = 1) =>
      (
        await request(f.server)
          .post(`/api/public/tables/${table.token}/orders`)
          .send({ clientOrderId: randomUUID(), items: [{ productId: pasta.id, quantity, modifiers: [] }] })
          .expect(201)
      ).body as CreatedOrder;
    const todayOrders = async () =>
      ((await owner.agent.get(`${base}/orders`).query({ scope: "today" }).expect(200)).body as OrderView[]).sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt),
      );
    const serve = async (orderId: string) => {
      for (const status of ["accepted", "preparing", "ready", "served"]) {
        await owner.agent.post(`${base}/orders/${orderId}/status`).send({ status }).expect(200);
      }
    };
    const account = async () => ((await owner.agent.get(`${base}/table-sessions`).expect(200)).body as TableSessionView[])[0]!;
    const bill = async () => (await request(f.server).get(`/api/public/tables/${table.token}/bill`).expect(200)).body as PublicTableBill;
    const pay = (sessionId: string, body: Record<string, unknown>) =>
      owner.agent.post(`${base}/table-sessions/${sessionId}/payments`).send(body);
    return { owner, restaurant, base, table, tableOrder, todayOrders, serve, account, bill, pay };
  }

  it("splits in equal parts paid with different methods, closes with the last one and reports each method", async () => {
    const s = await setup();
    await s.tableOrder(2);
    await s.tableOrder(1);
    const session = await s.account();
    expect(session).toMatchObject({ subtotal: 30000, remaining: 30000, split: null, payments: [] });

    const split = (await s.owner.agent.put(`${s.base}/table-sessions/${session.id}/split`).send({ mode: "equal", parts: 2 }).expect(200))
      .body as TableSessionView;
    expect(split).toMatchObject({ split: { mode: "equal", parts: 2 }, equalPart: { amount: 15000, pendingParts: [1, 2] } });

    // A partial payment is fine while the kitchen works; the one that completes the bill is not.
    const first = (await s.pay(session.id, { kind: "equal", part: 1, method: "cash", tip: 1000 }).expect(200)).body as TableSessionView;
    expect(first).toMatchObject({ status: "open", paid: 15000, remaining: 15000, equalPart: { amount: 15000, pendingParts: [2] } });
    expect(first.payments).toEqual([
      expect.objectContaining({ kind: "equal", part: 1, amount: 15000, tip: 1000, method: "cash", itemCount: 0 }),
    ]);
    expect((await s.pay(session.id, { kind: "equal", part: 1, method: "card_pos", tip: 0 }).expect(409)).body.code).toBe("SPLIT_PART_PAID");
    expect((await s.pay(session.id, { kind: "equal", part: 2, method: "card_pos", tip: 0 }).expect(409)).body.code).toBe(
      "TABLE_ORDERS_IN_PROGRESS",
    );
    expect(
      (await s.owner.agent.put(`${s.base}/table-sessions/${session.id}/split`).send({ mode: "equal", parts: 1 }).expect(400)).body.code,
    ).toBe("VALIDATION_FAILED");

    // The phone sees the plan and what is missing, without names.
    const phone = await s.bill();
    expect(phone).toMatchObject({
      split: { mode: "equal", parts: 2 },
      paid: 15000,
      remaining: 15000,
      equalPart: { amount: 15000, pendingParts: [2] },
      payments: [{ kind: "equal", amount: 15000, method: "cash", part: 1, itemCount: 0 }],
    });
    expect(JSON.stringify(phone)).not.toContain("Dueña");

    for (const order of await s.todayOrders()) await s.serve(order.id);
    const closed = (await s.pay(session.id, { kind: "equal", part: 2, method: "card_pos", tip: 500 }).expect(200))
      .body as TableSessionView;
    expect(closed).toMatchObject({ status: "closed", tip: 1500, paymentMethod: null, paymentMethods: ["cash", "card_pos"], remaining: 0 });
    expect((await s.bill())).toMatchObject({ open: false, paid: 30000, remaining: 0 });

    // The older order (20.000) got the cash part and 5.000 of the card part; the other one the rest by card.
    const [big, small] = await s.todayOrders();
    expect(big).toMatchObject({
      paymentStatus: "paid",
      paymentMethod: "cash",
      paymentBreakdown: [
        { method: "cash", amount: 15000 },
        { method: "card_pos", amount: 5000 },
      ],
    });
    expect(small).toMatchObject({ paymentStatus: "paid", paymentMethod: "card_pos", paymentBreakdown: [{ method: "card_pos", amount: 10000 }] });

    const summary = (await s.owner.agent.get(`${s.base}/reports/daily`).expect(200)).body as DailySummary;
    expect(summary).toMatchObject({ tips: 1500, sales: { total: 30000, paid: 30000 } });
    expect(summary.byPaymentMethod).toEqual({ cash: 15000, card_pos: 15000, transfer: 0 });

    // Payments of a closed account cannot be deleted.
    const del = await s.owner.agent.delete(`${s.base}/table-sessions/${session.id}/payments/${closed.payments[0]!.id}`).expect(409);
    expect(del.body.code).toBe("TABLE_SESSION_CLOSED");
  });

  it("charges by products, deletes a payment and charges what is left", async () => {
    const s = await setup();
    await s.tableOrder(2);
    await s.tableOrder(1);
    const session = await s.account();
    expect(session.itemLines).toHaveLength(2);
    const [twoLasagnas] = session.itemLines;
    expect(twoLasagnas).toMatchObject({ quantity: 2, paidQuantity: 0, unitAmount: 10000, total: 20000 });

    const byProducts = (
      await s.pay(session.id, { kind: "items", items: [{ orderId: twoLasagnas!.orderId, line: 0, quantity: 1 }], method: "transfer", tip: 0 }).expect(200)
    ).body as TableSessionView;
    expect(byProducts).toMatchObject({ paid: 10000, remaining: 20000 });
    expect(byProducts.payments[0]).toMatchObject({ kind: "items", amount: 10000, itemCount: 1 });
    expect(byProducts.itemLines[0]).toMatchObject({ paidQuantity: 1 });
    expect((await s.bill()).lines).toEqual([{ name: "Lasaña", options: [], quantity: 3, paidQuantity: 1, total: 30000 }]);

    const tooMany = await s.pay(session.id, {
      kind: "items",
      items: [{ orderId: twoLasagnas!.orderId, line: 0, quantity: 2 }],
      method: "cash",
      tip: 0,
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.code).toBe("INVALID_SPLIT_ITEMS");
    const over = await s.pay(session.id, { kind: "amount", amount: 25000, method: "cash", tip: 0 }).expect(409);
    expect(over.body).toMatchObject({ code: "PAYMENT_EXCEEDS_BALANCE", meta: { remaining: "20000" } });
    expect((await s.pay(session.id, { kind: "equal", part: 1, method: "cash", tip: 0 }).expect(409)).body.code).toBe("SPLIT_MODE_MISMATCH");

    // With payments registered, the orders of the account cannot be edited.
    const [order] = await s.todayOrders();
    const edit = await s.owner.agent
      .put(`${s.base}/orders/${order!.id}/items`)
      .send({ revision: 0, keep: [{ line: 0, quantity: 1 }], add: [] })
      .expect(409);
    expect(edit.body.code).toBe("TABLE_HAS_PAYMENTS");

    const deleted = (await s.owner.agent.delete(`${s.base}/table-sessions/${session.id}/payments/${byProducts.payments[0]!.id}`).expect(200))
      .body as TableSessionView;
    expect(deleted).toMatchObject({ payments: [], paid: 0, remaining: 30000 });
    await s.owner.agent.delete(`${s.base}/table-sessions/${session.id}/payments/${byProducts.payments[0]!.id}`).expect(404);

    await s.pay(session.id, { kind: "amount", amount: 12000, method: "cash", tip: 0 }).expect(200);
    for (const o of await s.todayOrders()) await s.serve(o.id);
    const closed = (await s.owner.agent.post(`${s.base}/table-sessions/${session.id}/close`).send({ method: "card_pos", tip: 2000 }).expect(200))
      .body as TableSessionView;
    expect(closed).toMatchObject({ status: "closed", paid: 30000, tip: 2000, paymentMethods: ["cash", "card_pos"] });
    expect(closed.payments.map((p) => [p.kind, p.amount, p.method])).toEqual([
      ["amount", 12000, "cash"],
      ["amount", 18000, "card_pos"],
    ]);
    const summary = (await s.owner.agent.get(`${s.base}/reports/daily`).expect(200)).body as DailySummary;
    expect(summary.byPaymentMethod).toEqual({ cash: 12000, card_pos: 18000, transfer: 0 });
  });

  it("is only for the floor staff, and validates the payment body", async () => {
    const s = await setup();
    await s.tableOrder();
    const session = await s.account();
    const cook = await f.staff(s.owner.agent, s.restaurant.id, ["kitchen"]);
    await cook.agent.post(`${s.base}/table-sessions/${session.id}/payments`).send({ kind: "amount", amount: 100, method: "cash", tip: 0 }).expect(403);
    const waiter = await f.staff(s.owner.agent, s.restaurant.id, ["waiter"]);
    await waiter.agent.post(`${s.base}/table-sessions/${session.id}/payments`).send({ kind: "amount", amount: 100, method: "cash", tip: 0 }).expect(200);

    await s.pay(session.id, { kind: "amount", amount: 1.5, method: "cash", tip: 0 }).expect(400);
    await s.pay(session.id, { kind: "amount", amount: 100, method: "bitcoin", tip: 0 }).expect(400);
    await s.pay(session.id, { kind: "gift", amount: 100, method: "cash", tip: 0 }).expect(400);
    await s.pay(session.id, { kind: "amount", amount: 100, method: "cash", tip: -1 }).expect(400);
    await s.pay("000000000000000000000000", { kind: "amount", amount: 100, method: "cash", tip: 0 }).expect(404);
  });
});
