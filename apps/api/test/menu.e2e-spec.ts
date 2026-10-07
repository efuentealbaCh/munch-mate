import type { AdminMenuView, ModifierGroupView, ProductView, PublicMenu } from "@app/types";
import sharp from "sharp";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { fixtures } from "./support/fixtures";
import { fetchMedia } from "./support/garage";
import { createTestApp, resetRateLimits, type TestContext } from "./support/test-app";

/** A phone-like JPEG with EXIF (camera, GPS). */
function photo(width = 1600, height = 1200): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#d97706" } })
    .jpeg()
    .withExif({ IFD0: { Make: "PhoneMaker" }, IFD3: { GPSLatitude: "33/1 26/1 0/1" } })
    .toBuffer();
}

describe("Menu (e2e)", () => {
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

  /** Owner + restaurant + a small menu: two categories, two modifier groups, three products. */
  async function seededMenu() {
    const { owner, restaurant } = await f.ownerWithRestaurant("Sanguchería Central");
    const base = `/api/restaurants/${restaurant.id}/menu`;
    const post = (path: string, body: object) => owner.agent.post(`${base}${path}`).send(body).expect(201);

    const sandwiches = (await post("/categories", { name: "Sándwiches" })).body;
    const drinks = (await post("/categories", { name: "Bebidas", description: "Heladas" })).body;
    const size = (await post("/modifier-groups", {
      name: "Tamaño",
      minSelect: 1,
      maxSelect: 1,
      options: [
        { name: "Normal", priceDelta: 0 },
        { name: "XL", priceDelta: 1500 },
      ],
    })).body as ModifierGroupView;
    const extras = (await post("/modifier-groups", {
      name: "Agregados",
      minSelect: 0,
      maxSelect: 3,
      options: [
        { name: "Palta", priceDelta: 800 },
        { name: "Queso", priceDelta: 600 },
        { name: "Tomate", priceDelta: 400 },
      ],
    })).body as ModifierGroupView;
    const italiano = (await post("/products", {
      categoryId: sandwiches.id,
      name: "Completo italiano",
      description: "Tomate, palta y mayo casera",
      price: 3990,
      modifierGroupIds: [size.id, extras.id],
    })).body as ProductView;
    const churrasco = (await post("/products", {
      categoryId: sandwiches.id,
      name: "Churrasco",
      price: 6990,
      modifierGroupIds: [extras.id],
    })).body as ProductView;
    const bebida = (await post("/products", { categoryId: drinks.id, name: "Bebida lata", price: 1500 }))
      .body as ProductView;

    return { owner, restaurant, base, sandwiches, drinks, size, extras, italiano, churrasco, bebida };
  }

  describe("building the menu", () => {
    it("returns categories and products in display order, with modifier group usage", async () => {
      const m = await seededMenu();

      const menu = (await m.owner.agent.get(m.base).expect(200)).body as AdminMenuView;

      expect(menu.categories.map((c) => c.name)).toEqual(["Sándwiches", "Bebidas"]);
      expect(menu.products.map((p) => p.name)).toEqual(["Completo italiano", "Churrasco", "Bebida lata"]);
      expect(menu.products[0]).toMatchObject({ price: 3990, available: true, visible: true, image: null });
      const usage = Object.fromEntries(menu.modifierGroups.map((g) => [g.name, g.usedByProducts]));
      expect(usage).toEqual({ Agregados: 2, Tamaño: 1 });
    });

    it("reorders categories and products, rejecting incomplete orders", async () => {
      const m = await seededMenu();

      await m.owner.agent.put(`${m.base}/categories/order`).send({ ids: [m.drinks.id, m.sandwiches.id] }).expect(200);
      await m.owner.agent
        .put(`${m.base}/categories/${m.sandwiches.id}/products/order`)
        .send({ ids: [m.churrasco.id, m.italiano.id] })
        .expect(204);

      const menu = (await m.owner.agent.get(m.base)).body as AdminMenuView;
      expect(menu.products.map((p) => p.name)).toEqual(["Bebida lata", "Churrasco", "Completo italiano"]);

      const missing = await m.owner.agent.put(`${m.base}/categories/order`).send({ ids: [m.drinks.id] }).expect(400);
      expect(missing.body.code).toBe("INVALID_ORDER");
    });

    it("moving a product to another category appends it at the end", async () => {
      const m = await seededMenu();

      await m.owner.agent.patch(`${m.base}/products/${m.italiano.id}`).send({ categoryId: m.drinks.id }).expect(200);

      const menu = (await m.owner.agent.get(m.base)).body as AdminMenuView;
      expect(menu.products.filter((p) => p.categoryId === m.drinks.id).map((p) => p.name)).toEqual([
        "Bebida lata",
        "Completo italiano",
      ]);
    });

    it("validates prices and modifier rules", async () => {
      const m = await seededMenu();

      const decimal = await m.owner.agent
        .post(`${m.base}/products`)
        .send({ categoryId: m.drinks.id, name: "Jugo", price: 1990.5 })
        .expect(400);
      expect(decimal.body.code).toBe("VALIDATION_FAILED");

      const impossible = await m.owner.agent
        .post(`${m.base}/modifier-groups`)
        .send({ name: "Salsas", minSelect: 0, maxSelect: 3, options: [{ name: "Ají", priceDelta: 0 }] })
        .expect(400);
      expect(impossible.body.code).toBe("INVALID_MODIFIER_RULES");
    });

    it("editing a group keeps option ids and updates every product that uses it", async () => {
      const m = await seededMenu();
      const [palta, queso] = m.extras.options;

      const edited = (
        await m.owner.agent
          .put(`${m.base}/modifier-groups/${m.extras.id}`)
          .send({
            name: "Agregados",
            minSelect: 0,
            maxSelect: 2,
            options: [
              { id: palta!.id, name: "Palta", priceDelta: 900 },
              { id: queso!.id, name: "Queso", priceDelta: 600 },
            ],
          })
          .expect(200)
      ).body as ModifierGroupView;

      expect(edited.options.map((o) => o.id)).toEqual([palta!.id, queso!.id]);
      expect(edited.usedByProducts).toBe(2);
    });

    it("deleting a group detaches it from products; non-empty categories cannot be deleted", async () => {
      const m = await seededMenu();

      await m.owner.agent.delete(`${m.base}/modifier-groups/${m.extras.id}`).expect(204);
      const menu = (await m.owner.agent.get(m.base)).body as AdminMenuView;
      expect(menu.products.find((p) => p.id === m.italiano.id)?.modifierGroupIds).toEqual([m.size.id]);

      const notEmpty = await m.owner.agent.delete(`${m.base}/categories/${m.drinks.id}`).expect(409);
      expect(notEmpty.body.code).toBe("CATEGORY_NOT_EMPTY");
      await m.owner.agent.delete(`${m.base}/products/${m.bebida.id}`).expect(204);
      await m.owner.agent.delete(`${m.base}/categories/${m.drinks.id}`).expect(204);
    });
  });

  describe("tenant isolation and roles", () => {
    it("rejects categories and modifier groups of another restaurant", async () => {
      const mine = await seededMenu();
      const other = await seededMenu();

      const foreignGroup = await mine.owner.agent
        .post(`${mine.base}/products`)
        .send({ categoryId: mine.drinks.id, name: "Robado", price: 1000, modifierGroupIds: [other.extras.id] })
        .expect(400);
      expect(foreignGroup.body.code).toBe("INVALID_MODIFIER_GROUP");

      const foreignCategory = await mine.owner.agent
        .post(`${mine.base}/products`)
        .send({ categoryId: other.drinks.id, name: "Robado", price: 1000 })
        .expect(400);
      expect(foreignCategory.body.code).toBe("INVALID_CATEGORY");

      // Ids of another tenant behave like nonexistent ones.
      await mine.owner.agent.patch(`${mine.base}/products/${other.bebida.id}`).send({ price: 1 }).expect(404);
      await other.owner.agent.get(mine.base).expect(404);
    });

    it("kitchen staff read the menu and mark items sold out, but cannot edit it", async () => {
      const m = await seededMenu();
      const cook = await f.staff(m.owner.agent, m.restaurant.id, ["kitchen"]);
      const palta = m.extras.options[0]!;

      await cook.agent.get(m.base).expect(200);
      await cook.agent.patch(`${m.base}/products/${m.italiano.id}/availability`).send({ available: false }).expect(204);
      await cook.agent
        .patch(`${m.base}/modifier-groups/${m.extras.id}/options/${palta.id}/availability`)
        .send({ available: false })
        .expect(204);

      expect((await cook.agent.patch(`${m.base}/products/${m.italiano.id}`).send({ price: 1 })).status).toBe(403);
      expect((await cook.agent.post(`${m.base}/categories`).send({ name: "Hack" })).status).toBe(403);

      const menu = (await m.owner.agent.get(m.base)).body as AdminMenuView;
      expect(menu.products.find((p) => p.id === m.italiano.id)?.available).toBe(false);
      expect(menu.modifierGroups.find((g) => g.id === m.extras.id)?.options[0]?.available).toBe(false);
    });
  });

  describe("photos", () => {
    const upload = (agent: TestAgent, url: string, file: Buffer, filename = "foto.jpg") =>
      agent.put(url).attach("file", file, filename);

    it("re-encodes the photo to WebP sizes, strips metadata and serves it publicly", async () => {
      const m = await seededMenu();

      const res = await upload(m.owner.agent, `${m.base}/products/${m.italiano.id}/image`, await photo()).expect(200);
      const product = res.body as ProductView;

      expect(Object.keys(product.image ?? {})).toEqual(["sm", "md", "lg"]);
      const lg = await fetchMedia(product.image!.lg);
      expect(lg.status).toBe(200);
      expect(lg.contentType).toBe("image/webp");
      const meta = await sharp(lg.body).metadata();
      expect([meta.width, meta.height, meta.exif]).toEqual([960, 720, undefined]);
    });

    it("replacing or deleting the photo removes the old files", async () => {
      const m = await seededMenu();
      const url = `${m.base}/products/${m.italiano.id}/image`;
      const first = (await upload(m.owner.agent, url, await photo())).body as ProductView;

      const second = (await upload(m.owner.agent, url, await photo(800, 800))).body as ProductView;
      expect(second.image!.md).not.toBe(first.image!.md);
      expect((await fetchMedia(first.image!.md)).status).toBe(404);

      await m.owner.agent.delete(`${m.base}/products/${m.italiano.id}`).expect(204);
      expect((await fetchMedia(second.image!.md)).status).toBe(404);
    });

    it("rejects files that are not images, oversized files and missing files", async () => {
      const m = await seededMenu();
      const url = `${m.base}/products/${m.italiano.id}/image`;

      const fake = await upload(m.owner.agent, url, Buffer.from("<svg onload=alert(1)>"), "x.jpg").expect(422);
      expect(fake.body.code).toBe("INVALID_IMAGE");

      const huge = await upload(m.owner.agent, url, Buffer.alloc(9 * 1024 * 1024, 1)).expect(413);
      expect(huge.body.code).toBe("FILE_TOO_LARGE");

      const none = await m.owner.agent.put(url).expect(400);
      expect(none.body.code).toBe("FILE_REQUIRED");
    });
  });

  describe("public menu", () => {
    it("shows only active categories and visible products, with modifiers, without a session", async () => {
      const m = await seededMenu();
      const owner = m.owner.agent;
      await owner.patch(`${m.base}/products/${m.churrasco.id}`).send({ visible: false }).expect(200);
      await owner.patch(`${m.base}/products/${m.italiano.id}/availability`).send({ available: false }).expect(204);
      const hiddenCategory = (await owner.post(`${m.base}/categories`).send({ name: "Secreta" })).body;
      await owner.post(`${m.base}/products`).send({ categoryId: hiddenCategory.id, name: "Oculto", price: 1 });
      await owner.patch(`${m.base}/categories/${hiddenCategory.id}`).send({ active: false }).expect(200);
      await owner.post(`${m.base}/categories`).send({ name: "Vacía" }).expect(201);
      await owner
        .patch(`/api/restaurants/${m.restaurant.id}`)
        .send({ description: "Los mejores completos", phone: "+56 9 1234 5678" })
        .expect(200);
      await owner.put(`/api/restaurants/${m.restaurant.id}/logo`).attach("file", await photo(600, 600), "logo.png");

      const res = await request(f.server).get(`/api/public/restaurants/${m.restaurant.slug}/menu`).expect(200);
      const menu = res.body as PublicMenu;

      expect(res.headers["cache-control"]).toMatch(/max-age=30/);
      expect(menu.restaurant).toMatchObject({
        name: "Sanguchería Central",
        description: "Los mejores completos",
        phone: "+56 9 1234 5678",
        currency: "CLP",
      });
      expect(menu.restaurant.logo?.md).toMatch(/-md\.webp$/);
      expect(menu.categories.map((c) => [c.name, c.products.map((p) => p.name)])).toEqual([
        ["Sándwiches", ["Completo italiano"]],
        ["Bebidas", ["Bebida lata"]],
      ]);
      const italiano = menu.categories[0]!.products[0]!;
      expect(italiano.available).toBe(false); // sold out: shown, not orderable
      expect(italiano.modifierGroups.map((g) => [g.name, g.minSelect, g.maxSelect])).toEqual([
        ["Tamaño", 1, 1],
        ["Agregados", 0, 3],
      ]);
      expect(JSON.stringify(menu)).not.toMatch(/visible|position|restaurantId|usedByProducts/);
    });

    it("answers 404 for unknown slugs", async () => {
      const res = await request(f.server).get("/api/public/restaurants/no-existe-este/menu").expect(404);

      expect(res.body.code).toBe("MENU_NOT_FOUND");
    });
  });
});
