import { randomUUID } from "node:crypto";
import type { FloorPlan, FloorPlanView, LiveSummary, OrderView, ProductView, RestaurantView, TableView } from "@app/types";
import request from "supertest";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, type TestContext } from "./support/test-app";

const PLAN: FloorPlan = {
  cols: 14,
  rows: 9,
  kitchen: { x: 0, y: 0, w: 4, h: 3 },
  pickup: { x: 11, y: 0, w: 3, h: 2 },
  door: { x: 13, y: 8 },
};

/** Phase 9 end to end: the owner draws the floor plan, the staff read it, and the live indicators. */
describe("Phase 9: live floor (e2e)", () => {
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

  /** Open restaurant (pickup on) with a $10.000 product and two tables. */
  async function setup() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Picada Nueve");
    const base = `/api/restaurants/${restaurant.id}`;
    const category = (await owner.agent.post(`${base}/menu/categories`).send({ name: "Fondos" }).expect(201)).body;
    const dish = (
      await owner.agent.post(`${base}/menu/products`).send({ categoryId: category.id, name: "Cazuela", price: 10000 }).expect(201)
    ).body as ProductView;
    const table1 = (await owner.agent.post(`${base}/tables`).send({ label: "Mesa 1" }).expect(201)).body as TableView;
    const table2 = (await owner.agent.post(`${base}/tables`).send({ label: "Mesa 2" }).expect(201)).body as TableView;
    await owner.agent.patch(base).send({ pickupEnabled: true }).expect(200);
    await owner.agent.put(`${base}/accepting-orders`).send({ acceptingOrders: true }).expect(200);
    return { owner, restaurant, base, dish, table1, table2 };
  }

  describe("floor plan", () => {
    it("the owner saves the plan with two tables and the staff read it", async () => {
      const s = await setup();
      const empty = (await s.owner.agent.get(`${s.base}/floor-plan`).expect(200)).body as FloorPlanView;
      expect(empty.plan).toBeNull();
      expect(empty.tables.map((t) => [t.label, t.layout])).toEqual([
        ["Mesa 1", null],
        ["Mesa 2", null],
      ]);

      const round = { x: 5, y: 4, shape: "round", seats: 4 } as const;
      const long = { x: 7, y: 4, shape: "square", seats: 6 } as const;
      const saved = (
        await s.owner.agent
          .put(`${s.base}/floor-plan`)
          .send({ plan: PLAN, tables: [{ tableId: s.table1.id, layout: round }, { tableId: s.table2.id, layout: long }] })
          .expect(200)
      ).body as FloorPlanView;
      expect(saved.plan).toEqual(PLAN);

      const kitchen = await f.staff(s.owner.agent, s.restaurant.id, ["kitchen"]);
      const read = (await kitchen.agent.get(`${s.base}/floor-plan`).expect(200)).body as FloorPlanView;
      expect(read).toEqual(saved);
      expect(read.tables).toEqual([
        { id: s.table1.id, label: "Mesa 1", active: true, layout: round },
        { id: s.table2.id, label: "Mesa 2", active: true, layout: long },
      ]);

      // Tables left out of the next save come off the plan.
      const moved = (
        await s.owner.agent
          .put(`${s.base}/floor-plan`)
          .send({ plan: { ...PLAN, pickup: null, door: null }, tables: [{ tableId: s.table2.id, layout: { ...long, y: 6 } }] })
          .expect(200)
      ).body as FloorPlanView;
      expect(moved.plan).toEqual({ ...PLAN, pickup: null, door: null });
      expect(moved.tables.map((t) => t.layout)).toEqual([null, { ...long, y: 6 }]);

      // A null plan deletes the plan and every layout.
      const cleared = (await s.owner.agent.put(`${s.base}/floor-plan`).send({ plan: null, tables: [] }).expect(200))
        .body as FloorPlanView;
      expect(cleared.plan).toBeNull();
      expect(cleared.tables.every((t) => t.layout === null)).toBe(true);
    });

    it("only the owner edits it; riders cannot read it; other tenants get 404", async () => {
      const s = await setup();
      const cashier = await f.staff(s.owner.agent, s.restaurant.id, ["cashier"]);
      const waiter = await f.staff(s.owner.agent, s.restaurant.id, ["waiter"]);
      const rider = await f.staff(s.owner.agent, s.restaurant.id, ["rider"]);

      await cashier.agent.get(`${s.base}/floor-plan`).expect(200);
      await waiter.agent.get(`${s.base}/floor-plan`).expect(200);
      const forbidden = await cashier.agent.put(`${s.base}/floor-plan`).send({ plan: PLAN, tables: [] }).expect(403);
      expect(forbidden.body.code).toBe("FORBIDDEN_ROLE");
      await rider.agent.get(`${s.base}/floor-plan`).expect(403);

      const stranger = await f.ownerWithRestaurant("Otro Local");
      const hidden = await stranger.owner.agent.get(`${s.base}/floor-plan`).expect(404);
      expect(hidden.body.code).toBe("RESTAURANT_NOT_FOUND");
      await stranger.owner.agent.put(`${s.base}/floor-plan`).send({ plan: PLAN, tables: [] }).expect(404);
    });

    it("rejects invalid plans and tables of another restaurant", async () => {
      const s = await setup();
      const put = (body: unknown) => s.owner.agent.put(`${s.base}/floor-plan`).send(body as object);

      const overlap = await put({
        plan: PLAN,
        tables: [{ tableId: s.table1.id, layout: { x: 1, y: 1, shape: "round", seats: 2 } }],
      }).expect(400);
      expect(overlap.body).toMatchObject({ code: "INVALID_FLOOR_PLAN", meta: { problem: "overlap" } });
      expect((await put({ plan: { ...PLAN, cols: 30 }, tables: [] }).expect(400)).body.meta).toEqual({ problem: "size" });
      expect((await put({ plan: { ...PLAN, door: { x: 6, y: 4 } } }).expect(400)).body.meta).toEqual({
        problem: "door_not_on_edge",
      });
      expect((await put({ plan: { cols: 14, rows: 9 }, tables: [] }).expect(400)).body.meta).toEqual({
        problem: "kitchen_required",
      });
      // Shape errors are caught by the DTO before the service.
      await put({ plan: PLAN, tables: [{ tableId: s.table1.id, layout: { x: 5, y: 4, shape: "oval", seats: 4 } }] }).expect(400);
      await put({ tables: [] }).expect(400);

      const other = await f.ownerWithRestaurant("Vecino");
      const foreign = (
        await other.owner.agent.post(`/api/restaurants/${other.restaurant.id}/tables`).send({ label: "Mesa X" }).expect(201)
      ).body as TableView;
      const unknown = await put({ plan: PLAN, tables: [{ tableId: foreign.id, layout: { x: 5, y: 4, shape: "round", seats: 4 } }] }).expect(400);
      expect(unknown.body).toMatchObject({ code: "UNKNOWN_TABLE", meta: { tableId: foreign.id } });
      await put({ plan: PLAN, tables: [{ tableId: "no-existe", layout: null }] }).expect(400);

      // Nothing was written by the rejected saves.
      expect(((await s.owner.agent.get(`${s.base}/floor-plan`).expect(200)).body as FloorPlanView).plan).toBeNull();
    });
  });

  describe("live indicators", () => {
    it("count today's sales, orders in progress, the kitchen time and the tables", async () => {
      const s = await setup();
      await s.owner.agent
        .put(`${s.base}/floor-plan`)
        .send({ plan: PLAN, tables: [{ tableId: s.table1.id, layout: { x: 5, y: 4, shape: "round", seats: 4 } }] })
        .expect(200);
      const target = (await s.owner.agent.patch(s.base).send({ kitchenTargetMinutes: 25 }).expect(200)).body as RestaurantView;
      expect(target.kitchenTargetMinutes).toBe(25);
      await s.owner.agent.patch(s.base).send({ kitchenTargetMinutes: 4 }).expect(400);

      await request(f.server)
        .post(`/api/public/tables/${s.table1.token}/orders`)
        .send({ clientOrderId: randomUUID(), items: [{ productId: s.dish.id, quantity: 2, modifiers: [] }] })
        .expect(201);
      await request(f.server)
        .post(`/api/public/restaurants/${s.restaurant.slug}/orders`)
        .send({
          clientOrderId: randomUUID(),
          customerName: "Rita",
          customerPhone: "9 8765 4321",
          items: [{ productId: s.dish.id, quantity: 1, modifiers: [] }],
        })
        .expect(201);
      const orders = (await s.owner.agent.get(`${s.base}/orders`).expect(200)).body as OrderView[];
      const dineIn = orders.find((o) => o.channel === "dine_in")!;
      for (const status of ["accepted", "preparing", "ready"]) {
        await s.owner.agent.post(`${s.base}/orders/${dineIn.id}/status`).send({ status }).expect(200);
      }
      const pickup = orders.find((o) => o.channel === "pickup")!;
      await s.owner.agent.post(`${s.base}/orders/${pickup.id}/status`).send({ status: "rejected", reason: "Sin stock" }).expect(200);

      const cashier = await f.staff(s.owner.agent, s.restaurant.id, ["cashier"]);
      const live = (await cashier.agent.get(`${s.base}/live`).expect(200)).body as LiveSummary;

      expect(live.sales).toEqual({ total: 20000, currency: "CLP", changePercent: null });
      expect(live.hourly.reduce((sum, h) => sum + h.total, 0)).toBe(20000);
      expect(live.hourly.at(-1)!.hour).toBe(live.hourly.length - 1);
      expect(live.inProgress).toEqual({ dine_in: 1, pickup: 0, delivery: 0, total: 1 });
      expect(live.kitchen).toMatchObject({ targetMinutes: 25, sample: 1 });
      expect(live.kitchen.averageMinutes).toBe(0);
      expect(live.tables).toEqual({ positioned: 1, occupied: 1, callingWaiter: 0, billRequested: 0, payingInParts: 0 });

      // The ticket timer: when the order entered its current status.
      const ready = (await s.owner.agent.get(`${s.base}/orders/${dineIn.id}`).expect(200)).body as OrderView;
      expect(ready.statusHistory.at(-1)).toMatchObject({ status: "ready" });
      expect(Date.parse(ready.statusHistory.at(-1)!.at)).toBeLessThanOrEqual(Date.parse(live.at));
    });

    it("is for the owner and the cashier only", async () => {
      const s = await setup();
      const kitchen = await f.staff(s.owner.agent, s.restaurant.id, ["kitchen"]);
      const waiter = await f.staff(s.owner.agent, s.restaurant.id, ["waiter"]);
      await s.owner.agent.get(`${s.base}/live`).expect(200);
      expect((await kitchen.agent.get(`${s.base}/live`).expect(403)).body.code).toBe("FORBIDDEN_ROLE");
      await waiter.agent.get(`${s.base}/live`).expect(403);
      await request(f.server).get(`${s.base}/live`).expect(401);
      const stranger = await f.ownerWithRestaurant("Ajeno");
      await stranger.owner.agent.get(`${s.base}/live`).expect(404);
    });
  });
});
