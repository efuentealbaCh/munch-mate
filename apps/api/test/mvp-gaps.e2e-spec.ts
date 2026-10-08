import { randomUUID } from "node:crypto";
import type {
  DailySummary,
  ModifierGroupView,
  PlatformRestaurantPage,
  ProductView,
  PublicMenu,
  RestaurantView,
  TableView,
  WeeklyHours,
} from "@app/types";
import { localClock } from "@app/utils";
import { getConnectionToken } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, type TestContext } from "./support/test-app";

const TZ = "America/Santiago";

/** "HH:MM" of now + `offset` minutes in the restaurant's timezone. */
function hhmm(offset: number): string {
  const minutes = (((localClock(new Date(), TZ).minutes + offset) % 1440) + 1440) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
const everyDay = (open: string, close: string): WeeklyHours => Array.from({ length: 7 }, () => [{ open, close }]);

describe("MVP gaps: opening hours, daily summary, platform admin (e2e)", () => {
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

  /** Open restaurant with one $3.490 product and a table. */
  async function setup() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Completos Don Pepe");
    const base = `/api/restaurants/${restaurant.id}`;
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
    const table = (await owner.agent.post(`${base}/tables`).send({ label: "Mesa 1" }).expect(201)).body as TableView;
    await owner.agent.put(`${base}/accepting-orders`).send({ acceptingOrders: true }).expect(200);
    const order = (quantity = 1) =>
      request(f.server)
        .post(`/api/public/tables/${table.token}/orders`)
        .send({
          clientOrderId: randomUUID(),
          items: [{ productId: completo.id, quantity, modifiers: [{ groupId: size.id, optionIds: [size.options[0]!.id] }] }],
        });
    return { owner, restaurant, base, table, order };
  }

  describe("opening hours", () => {
    it("blocks orders outside the schedule even with the switch on, and says when it opens", async () => {
      const s = await setup();
      const opensAt = hhmm(120);

      const view = (
        await s.owner.agent.put(`${s.base}/opening-hours`).send({ openingHours: everyDay(opensAt, hhmm(180)) }).expect(200)
      ).body as RestaurantView;

      expect(view.openState.openNow).toBe(false);
      const res = await s.order().expect(409);
      expect(res.body.code).toBe("OUTSIDE_OPENING_HOURS");
      expect(res.body.meta.nextOpeningAt).toBe(view.openState.nextOpeningAt);
      const menu = (await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/menu`).expect(200))
        .body as PublicMenu;
      expect(menu.restaurant.openState).toEqual(view.openState);
      expect((await request(f.server).get(`/api/public/tables/${s.table.token}`).expect(200)).body.openState.openNow).toBe(
        false,
      );
    });

    it("lets customers order inside the schedule, and clearing it falls back to the switch", async () => {
      const s = await setup();
      await s.owner.agent.put(`${s.base}/opening-hours`).send({ openingHours: everyDay(hhmm(-60), hhmm(60)) }).expect(200);
      await s.order().expect(201);

      await s.owner.agent.put(`${s.base}/opening-hours`).send({ openingHours: everyDay(hhmm(60), hhmm(90)) }).expect(200);
      await s.order().expect(409);
      const cleared = (await s.owner.agent.put(`${s.base}/opening-hours`).send({ openingHours: null }).expect(200))
        .body as RestaurantView;
      expect(cleared.openingHours).toBeNull();
      await s.order().expect(201);
    });

    it("validates the schedule and only lets the owner change it", async () => {
      const s = await setup();
      const overlap = everyDay("12:00", "16:00").map((day) => [...day, { open: "15:00", close: "18:00" }]);

      const res = await s.owner.agent.put(`${s.base}/opening-hours`).send({ openingHours: overlap }).expect(400);
      expect(res.body.code).toBe("INVALID_OPENING_HOURS");
      await s.owner.agent.put(`${s.base}/opening-hours`).send({ openingHours: [[]] }).expect(400);
      const cashier = await f.staff(s.owner.agent, s.restaurant.id, ["cashier"]);
      await cashier.agent.put(`${s.base}/opening-hours`).send({ openingHours: null }).expect(403);
    });
  });

  describe("daily summary", () => {
    it("sums today's sales for the owner and the cashier, but not the kitchen", async () => {
      const s = await setup();
      const ids: string[] = [];
      for (const quantity of [1, 2, 3]) {
        await s.order(quantity).expect(201);
      }
      const orders = (await s.owner.agent.get(`${s.base}/orders`).expect(200)).body as { id: string }[];
      ids.push(...orders.map((o) => o.id));
      await s.owner.agent.post(`${s.base}/orders/${ids[0]}/payment`).send({ method: "cash" }).expect(200);
      await s.owner.agent.post(`${s.base}/orders/${ids[2]}/status`).send({ status: "rejected", reason: "Sin pan" }).expect(200);

      const summary = (await s.owner.agent.get(`${s.base}/reports/daily`).expect(200)).body as DailySummary;

      expect(summary.orders).toMatchObject({ total: 3, rejected: 1, inProgress: 2 });
      expect(summary.sales).toMatchObject({ total: 3490 * 3, paid: 3490, unpaid: 3490 * 2 });
      expect(summary.byPaymentMethod.cash).toBe(3490);
      expect(summary.topProducts).toEqual([{ name: "Completo italiano", quantity: 3, total: 3490 * 3 }]);

      const cashier = await f.staff(s.owner.agent, s.restaurant.id, ["cashier"]);
      const cook = await f.staff(s.owner.agent, s.restaurant.id, ["kitchen"]);
      await cashier.agent.get(`${s.base}/reports/daily`).expect(200);
      await cook.agent.get(`${s.base}/reports/daily`).expect(403);
    });

    it("answers any date, empty for days without orders, and rejects malformed dates", async () => {
      const s = await setup();

      const empty = (await s.owner.agent.get(`${s.base}/reports/daily?date=2026-01-15`).expect(200)).body as DailySummary;

      expect(empty).toMatchObject({ date: "2026-01-15", orders: { total: 0 }, sales: { total: 0 } });
      await s.owner.agent.get(`${s.base}/reports/daily?date=15-01-2026`).expect(400);
    });
  });

  describe("platform admin", () => {
    async function makeAdmin(agent: TestAgent): Promise<void> {
      const email = (await agent.get("/api/auth/me").expect(200)).body.email as string;
      const connection = ctx.app.get<Connection>(getConnectionToken());
      await connection.collection("users").updateOne({ email }, { $set: { platformRole: "admin" } });
    }

    it("hides the platform routes from everyone else", async () => {
      const s = await setup();

      await s.owner.agent.get("/api/platform/restaurants").expect(404);
      await request(f.server).get("/api/platform/restaurants").expect(401);
      expect((await s.owner.agent.get("/api/auth/me").expect(200)).body.platformRole).toBeNull();
    });

    it("lists and searches restaurants with their owners, and suspends one", async () => {
      const s = await setup();
      const admin = await f.user({ name: "Admin" });
      await makeAdmin(admin.agent);

      expect((await admin.agent.get("/api/auth/me").expect(200)).body.platformRole).toBe("admin");
      const page = (
        await admin.agent.get(`/api/platform/restaurants?q=${encodeURIComponent(s.restaurant.slug)}`).expect(200)
      ).body as PlatformRestaurantPage;
      expect(page.total).toBe(1);
      expect(page.items[0]).toMatchObject({
        id: s.restaurant.id,
        status: "active",
        acceptingOrders: true,
        members: 1,
        owners: [{ name: "Dueña" }],
      });

      await admin.agent
        .put(`/api/platform/restaurants/${s.restaurant.id}/status`)
        .send({ status: "suspended" })
        .expect(204);

      await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/menu`).expect(404);
      await s.order().expect(404);
      // Read-only for the team.
      await s.owner.agent.get(s.base).expect(200);
      await s.owner.agent.patch(s.base).send({ description: "x" }).expect(403);
      const suspended = (await admin.agent.get("/api/platform/restaurants?status=suspended").expect(200))
        .body as PlatformRestaurantPage;
      expect(suspended.items.map((r) => r.id)).toContain(s.restaurant.id);
      expect(suspended.items.find((r) => r.id === s.restaurant.id)?.acceptingOrders).toBe(false);

      await admin.agent.put(`/api/platform/restaurants/${s.restaurant.id}/status`).send({ status: "active" }).expect(204);
      await request(f.server).get(`/api/public/restaurants/${s.restaurant.slug}/menu`).expect(200);
      await admin.agent
        .put("/api/platform/restaurants/000000000000000000000000/status")
        .send({ status: "active" })
        .expect(404);
    });
  });
});
