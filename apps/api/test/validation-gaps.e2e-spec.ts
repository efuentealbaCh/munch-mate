import { randomUUID } from "node:crypto";
import type { CreatedOrder, OrderView, PublicOrderView, RestaurantView, TableView } from "@app/types";
import request from "supertest";
import { fixtures } from "./support/fixtures";
import { createTestApp, resetRateLimits, type TestContext } from "./support/test-app";

describe("Validation gaps: unique names, phone format, cancellation reasons (e2e)", () => {
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

  async function owner() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Completos Don Pepe");
    return { agent: owner.agent, restaurant, base: `/api/restaurants/${restaurant.id}` };
  }

  describe("unique names within a restaurant", () => {
    it("rejects a table label already used, however it is written, also when renaming", async () => {
      const o = await owner();
      await o.agent.post(`${o.base}/tables`).send({ label: "Mesa 1" }).expect(201);
      const terraza = (await o.agent.post(`${o.base}/tables`).send({ label: "Terraza" }).expect(201)).body as TableView;

      expect((await o.agent.post(`${o.base}/tables`).send({ label: "mesa  1" }).expect(409)).body.code).toBe(
        "TABLE_LABEL_TAKEN",
      );
      await o.agent.patch(`${o.base}/tables/${terraza.id}`).send({ label: "MESA 1" }).expect(409);
      // Keeping its own name (or changing only the case) is fine.
      await o.agent.patch(`${o.base}/tables/${terraza.id}`).send({ label: "TERRAZA" }).expect(200);
    });

    it("rejects a delivery zone name already used, accents and case aside", async () => {
      const o = await owner();
      await o.agent.post(`${o.base}/delivery-zones`).send({ name: "Ñuñoa", fee: 1500, minOrder: 0 }).expect(201);
      const other = (await o.agent.post(`${o.base}/delivery-zones`).send({ name: "La Reina", fee: 2000, minOrder: 0 }).expect(201))
        .body as { id: string };

      expect((await o.agent.post(`${o.base}/delivery-zones`).send({ name: "nunoa", fee: 0, minOrder: 0 }).expect(409)).body.code).toBe(
        "ZONE_NAME_TAKEN",
      );
      await o.agent.patch(`${o.base}/delivery-zones/${other.id}`).send({ name: "ÑUÑOA" }).expect(409);
    });

    it("rejects duplicate categories, and duplicate products only within the same category", async () => {
      const o = await owner();
      const completos = (await o.agent.post(`${o.base}/menu/categories`).send({ name: "Completos" }).expect(201)).body;
      const promos = (await o.agent.post(`${o.base}/menu/categories`).send({ name: "Promociones" }).expect(201)).body;

      expect((await o.agent.post(`${o.base}/menu/categories`).send({ name: "COMPLETOS" }).expect(409)).body.code).toBe(
        "CATEGORY_NAME_TAKEN",
      );
      await o.agent.patch(`${o.base}/menu/categories/${promos.id}`).send({ name: "completos" }).expect(409);

      const product = (name: string, categoryId: string) =>
        o.agent.post(`${o.base}/menu/products`).send({ categoryId, name, price: 3490 });
      await product("Completo italiano", completos.id).expect(201);
      expect((await product("completo  ITALIANO", completos.id).expect(409)).body.code).toBe("PRODUCT_NAME_TAKEN");
      // Same name in another category is allowed (e.g. a promo version)...
      const promo = (await product("Completo italiano", promos.id).expect(201)).body as { id: string };
      // ...but moving it into a category that already has one is not.
      await o.agent.patch(`${o.base}/menu/products/${promo.id}`).send({ categoryId: completos.id }).expect(409);
    });
  });

  describe("restaurant phone", () => {
    it("stores the phone normalized and rejects junk", async () => {
      const o = await owner();

      const view = (await o.agent.patch(o.base).send({ phone: "9 1234 5678" }).expect(200)).body as RestaurantView;
      expect(view.phone).toBe("+56912345678");

      expect((await o.agent.patch(o.base).send({ phone: "------" }).expect(400)).body.code).toBe("INVALID_PHONE");
      expect(((await o.agent.patch(o.base).send({ phone: "" }).expect(200)).body as RestaurantView).phone).toBe("");
    });
  });

  describe("cancellation reasons", () => {
    async function withOrder() {
      const o = await owner();
      const category = (await o.agent.post(`${o.base}/menu/categories`).send({ name: "Completos" }).expect(201)).body;
      const completo = (
        await o.agent.post(`${o.base}/menu/products`).send({ categoryId: category.id, name: "Completo", price: 3490 }).expect(201)
      ).body as { id: string };
      const table = (await o.agent.post(`${o.base}/tables`).send({ label: "Mesa 1" }).expect(201)).body as TableView;
      await o.agent.put(`${o.base}/accepting-orders`).send({ acceptingOrders: true }).expect(200);
      const created = (
        await request(f.server)
          .post(`/api/public/tables/${table.token}/orders`)
          .send({ clientOrderId: randomUUID(), items: [{ productId: completo.id, quantity: 1, modifiers: [] }] })
          .expect(201)
      ).body as CreatedOrder;
      const [order] = (await o.agent.get(`${o.base}/orders`).expect(200)).body as OrderView[];
      return { ...o, order: order!, accessToken: created.accessToken };
    }
    const lookup = async (accessToken: string) =>
      (await request(f.server).post("/api/public/orders/lookup").send({ accessToken }).expect(200)).body as PublicOrderView;

    it("requires a reason when the staff cancels, and shows it to the customer", async () => {
      const s = await withOrder();
      const status = (body: object) => s.agent.post(`${s.base}/orders/${s.order.id}/status`).send(body);

      await status({ status: "accepted" }).expect(200);
      expect((await status({ status: "cancelled" }).expect(400)).body.code).toBe("REASON_REQUIRED");
      await status({ status: "cancelled", reason: "Se cortó la luz en la cocina" }).expect(200);

      expect(await lookup(s.accessToken)).toMatchObject({
        status: "cancelled",
        cancelReason: "Se cortó la luz en la cocina",
        rejectReason: null,
      });
    });

    it("tells the customer when they cancelled it themselves", async () => {
      const s = await withOrder();

      await request(f.server).post("/api/public/orders/cancel").send({ accessToken: s.accessToken }).expect(200);

      expect((await lookup(s.accessToken)).cancelReason).toBe("Cancelado por el cliente");
    });
  });
});
