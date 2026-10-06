import type { Connection } from "mongoose";
import type { MembershipsRepository } from "./memberships.repository";
import { baseSlugFor, RestaurantsService } from "./restaurants.service";
import { type RestaurantsRepository, SlugTakenError } from "./restaurants.repository";

describe("baseSlugFor", () => {
  it.each([
    ["La Picá de Juan", "la-pica-de-juan"],
    ["Yo", "restaurante-yo"], // too short
    ["Admin", "restaurante-admin"], // reserved
    ["🍕", "restaurante"], // nothing usable
  ])("%s → %s", (name, slug) => {
    expect(baseSlugFor(name)).toBe(slug);
  });
});

describe("RestaurantsService.create", () => {
  function setup(existingSlugs: string[], failFirstInsert = false) {
    const created: string[] = [];
    let inserts = 0;
    const restaurants = {
      findSlugFamily: jest.fn(async () => existingSlugs),
      create: jest.fn(async (input: { name: string; slug: string; createdBy: string }) => {
        inserts++;
        // Simulates another request grabbing the same slug between the lookup and the insert.
        if (failFirstInsert && inserts === 1) {
          existingSlugs.push(input.slug);
          throw new SlugTakenError(input.slug);
        }
        created.push(input.slug);
        return { id: "r1", ...input, currency: "CLP", timezone: "America/Santiago", status: "active" as const };
      }),
    };
    const memberships = { create: jest.fn() };
    const connection = { transaction: (fn: (session: unknown) => Promise<unknown>) => fn({}) };
    const service = new RestaurantsService(
      restaurants as unknown as RestaurantsRepository,
      memberships as unknown as MembershipsRepository,
      connection as unknown as Connection,
    );
    return { service, created, memberships };
  }

  it("picks the lowest free suffix", async () => {
    const { service, created } = setup(["la-pica", "la-pica-2", "la-pica-4"]);

    await service.create("u1", { name: "La Picá" });

    expect(created).toEqual(["la-pica-3"]);
  });

  it("rejects a chosen slug that is taken, suggesting the next free one", async () => {
    const { service } = setup(["el-hoyo"], true);

    await expect(service.create("u1", { name: "Otro", slug: " El-Hoyo " })).rejects.toMatchObject({
      response: { code: "SLUG_TAKEN", meta: { suggestion: "el-hoyo-2" } },
    });
  });

  it("rejects an invalid chosen slug before touching the database", async () => {
    const { service, created } = setup([]);

    await expect(service.create("u1", { name: "Otro", slug: "con espacios" })).rejects.toMatchObject({
      response: { code: "INVALID_SLUG" },
    });
    expect(created).toEqual([]);
  });

  it("retries with the next suffix when a concurrent creation takes the slug first", async () => {
    const { service, created, memberships } = setup(["la-pica"], true);

    const restaurant = await service.create("u1", { name: "La Picá" });

    expect(created).toEqual(["la-pica-3"]);
    expect(restaurant.myRoles).toEqual(["owner"]);
    expect(memberships.create).toHaveBeenCalledWith("r1", "u1", ["owner"], {});
  });
});

describe("RestaurantsService queries and updates", () => {
  const record = (id: string, slug: string) => ({
    id,
    name: slug,
    slug,
    currency: "CLP",
    timezone: "America/Santiago",
    status: "active" as const,
    createdBy: "u1",
  });
  const tenant = { restaurantId: "r1", roles: ["owner" as const], status: "active" as const };

  function setup() {
    const restaurants = {
      findByIds: jest.fn(async () => [record("r1", "uno"), record("r2", "dos")]),
      findById: jest.fn(async () => record("r1", "uno")),
      slugExists: jest.fn(async (slug: string) => slug === "uno"),
      findSlugFamily: jest.fn(async () => ["uno"]),
      update: jest.fn(async (_id: string, changes: { slug?: string; name?: string }) => {
        if (changes.slug === "dos") throw new SlugTakenError("dos");
        return { ...record("r1", "uno"), ...changes };
      }),
    };
    const memberships = {
      listByUser: jest.fn(async () => [
        { restaurantId: "r2", userId: "u1", roles: ["kitchen"], joinedAt: new Date() },
        { restaurantId: "r1", userId: "u1", roles: ["owner"], joinedAt: new Date() },
        { restaurantId: "deleted", userId: "u1", roles: ["owner"], joinedAt: new Date() },
      ]),
    };
    const service = new RestaurantsService(
      restaurants as unknown as RestaurantsRepository,
      memberships as unknown as MembershipsRepository,
      {} as Connection,
    );
    return { service, restaurants };
  }

  it("lists the user's restaurants in membership order with their roles, skipping missing ones", async () => {
    const list = await setup().service.listForUser("u1");

    expect(list.map((r) => [r.slug, r.myRoles])).toEqual([
      ["dos", ["kitchen"]],
      ["uno", ["owner"]],
    ]);
  });

  it("checks slug availability", async () => {
    const { service } = setup();

    await expect(service.checkSlug("Uno")).resolves.toEqual({
      slug: "uno",
      available: false,
      reason: "taken",
      suggestion: "uno-2",
    });
    await expect(service.checkSlug("libre")).resolves.toEqual({ slug: "libre", available: true });
    await expect(service.checkSlug("x")).resolves.toMatchObject({ available: false, reason: "too_short" });
  });

  it("updates name and normalized slug, and maps a taken slug to SLUG_TAKEN", async () => {
    const { service, restaurants } = setup();

    await expect(service.update(tenant, { name: "Nuevo", slug: " NUEVO-SLUG " })).resolves.toMatchObject({
      name: "Nuevo",
      slug: "nuevo-slug",
      myRoles: ["owner"],
    });
    expect(restaurants.update).toHaveBeenCalledWith("r1", { name: "Nuevo", slug: "nuevo-slug" });

    await expect(service.update(tenant, { slug: "dos" })).rejects.toMatchObject({
      response: { code: "SLUG_TAKEN" },
    });
  });

  it("returns the tenant's restaurant", async () => {
    await expect(setup().service.get(tenant)).resolves.toMatchObject({ id: "r1", myRoles: ["owner"] });
  });
});
