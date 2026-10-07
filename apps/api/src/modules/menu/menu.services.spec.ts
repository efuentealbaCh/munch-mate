import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { MediaService } from "../../infra/storage/media.service";
import type { RestaurantsRepository } from "../restaurants/restaurants.repository";
import type { CategoriesRepository } from "./categories.repository";
import { isPermutation } from "./menu.errors";
import { MenuService } from "./menu.service";
import type { ModifierGroupsRepository } from "./modifier-groups.repository";
import { ModifierGroupsService } from "./modifier-groups.service";
import type { ProductRecord, ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";
import { PublicMenuService } from "./public-menu.service";

const media = {
  productImage: (key: string | null) => (key ? { sm: `${key}-sm`, md: `${key}-md`, lg: `${key}-lg` } : null),
  logoImage: () => null,
  storeImage: jest.fn(async () => "new-key"),
  deleteImage: jest.fn(),
} as unknown as MediaService & { storeImage: jest.Mock; deleteImage: jest.Mock };

const product = (overrides: Partial<ProductRecord> = {}): ProductRecord => ({
  id: "p1",
  categoryId: "c1",
  name: "Completo",
  description: "",
  price: 3990,
  available: true,
  visible: true,
  imageKey: null,
  modifierGroupIds: [],
  position: 0,
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe("isPermutation", () => {
  it.each([
    [["a", "b"], ["b", "a"], true],
    [["a"], ["a", "b"], false],
    [["a", "a"], ["a", "b"], false],
    [["a", "c"], ["a", "b"], false],
  ])("%j vs %j → %s", (ids, expected, result) => {
    expect(isPermutation(ids, expected)).toBe(result);
  });
});

describe("ProductsService", () => {
  function setup(options: { categoryExists?: boolean; existingGroups?: string[]; current?: ProductRecord | null } = {}) {
    const products = {
      create: jest.fn(async (_r: string, input: object) => product(input)),
      findOne: jest.fn(async () => (options.current === undefined ? product() : options.current)),
      update: jest.fn(async (_r: string, _p: string, changes: object) => product(changes)),
      delete: jest.fn(async () => product({ imageKey: "old" })),
      setImageKey: jest.fn(async () => "old"),
      setAvailability: jest.fn(async () => true),
      idsInCategory: jest.fn(async () => ["p1", "p2"]),
      reorderInCategory: jest.fn(),
    };
    const categories = { exists: jest.fn(async () => options.categoryExists ?? true) };
    const groups = { existingIds: jest.fn(async () => new Set(options.existingGroups ?? [])) };
    const service = new ProductsService(
      products as unknown as ProductsRepository,
      categories as unknown as CategoriesRepository,
      groups as unknown as ModifierGroupsRepository,
      media,
    );
    return { service, products, categories };
  }

  it("creates a product with defaults", async () => {
    const { service, products } = setup();

    const view = await service.create("r1", { categoryId: "c1", name: "Completo", price: 3990 });

    expect(products.create).toHaveBeenCalledWith("r1", expect.objectContaining({ description: "", visible: true, modifierGroupIds: [] }));
    expect(view.image).toBeNull();
  });

  it("rejects categories and modifier groups that are not in the restaurant", async () => {
    await expect(setup({ categoryExists: false }).service.create("r1", { categoryId: "x", name: "A", price: 1 })).rejects.toMatchObject({
      response: { code: "INVALID_CATEGORY" },
    });
    await expect(
      setup({ existingGroups: ["g1"] }).service.create("r1", { categoryId: "c1", name: "A", price: 1, modifierGroupIds: ["g1", "g2"] }),
    ).rejects.toMatchObject({ response: { code: "INVALID_MODIFIER_GROUP" } });
  });

  it("only validates the category when it actually changes", async () => {
    const { service, categories, products } = setup();

    await service.update("r1", "p1", { categoryId: "c1", price: 100 });
    expect(categories.exists).not.toHaveBeenCalled();
    expect(products.update).toHaveBeenCalledWith("r1", "p1", { categoryId: "c1", price: 100 }, false);

    await service.update("r1", "p1", { categoryId: "c2" });
    expect(categories.exists).toHaveBeenCalledWith("r1", "c2");
    expect(products.update).toHaveBeenLastCalledWith("r1", "p1", { categoryId: "c2" }, true);
  });

  it("reports missing products", async () => {
    await expect(setup({ current: null }).service.update("r1", "p9", { price: 1 })).rejects.toThrow(NotFoundException);
    await expect(setup({ current: null }).service.setImage("r1", "p9", Buffer.from("x"))).rejects.toThrow(NotFoundException);
    expect(media.storeImage).not.toHaveBeenCalled(); // nothing processed for a wrong id
  });

  it("replaces the photo and deletes the previous one", async () => {
    const { service, products } = setup();

    await service.setImage("r1", "p1", Buffer.from("img"));

    expect(media.storeImage).toHaveBeenCalledWith("product", "restaurants/r1/products/p1", Buffer.from("img"));
    expect(products.setImageKey).toHaveBeenCalledWith("r1", "p1", "new-key");
    expect(media.deleteImage).toHaveBeenCalledWith("product", "old");
  });

  it("deleting a product deletes its photo", async () => {
    await setup().service.delete("r1", "p1");

    expect(media.deleteImage).toHaveBeenCalledWith("product", "old");
  });

  it("reorders only with the exact set of the category's products", async () => {
    const { service, products } = setup();

    await expect(service.reorder("r1", "c1", ["p1"])).rejects.toThrow(BadRequestException);
    await service.reorder("r1", "c1", ["p2", "p1"]);
    expect(products.reorderInCategory).toHaveBeenCalledWith("r1", "c1", ["p2", "p1"]);
  });
});

describe("ModifierGroupsService", () => {
  const options = [
    { name: "A", priceDelta: 0, available: true },
    { name: "B", priceDelta: 500, available: true },
  ];

  function setup() {
    const groups = {
      list: jest.fn(async () => [{ id: "g1", name: "Tamaño", minSelect: 1, maxSelect: 1, options: [] }]),
      create: jest.fn(async (_r: string, input: object) => ({ id: "g1", ...input })),
      replace: jest.fn(async () => null),
      findOne: jest.fn(async () => ({ id: "g1" })),
      delete: jest.fn(),
      setOptionAvailability: jest.fn(async () => false),
    };
    const products = {
      countByModifierGroup: jest.fn(async () => new Map([["g1", 4]])),
      removeModifierGroup: jest.fn(),
    };
    const service = new ModifierGroupsService(
      groups as unknown as ModifierGroupsRepository,
      products as unknown as ProductsRepository,
    );
    return { service, groups, products };
  }

  it.each([
    [{ minSelect: 2, maxSelect: 1 }, /menor que el mínimo/],
    [{ minSelect: 0, maxSelect: 3 }, /no puede superar la cantidad de opciones/],
  ])("rejects unsatisfiable rules %j", async (rules, message) => {
    await expect(setup().service.create("r1", { name: "X", ...rules, options })).rejects.toThrow(message);
  });

  it("lists groups with how many products use them", async () => {
    await expect(setup().service.list("r1")).resolves.toEqual([expect.objectContaining({ id: "g1", usedByProducts: 4 })]);
  });

  it("detaches a deleted group from products before deleting it", async () => {
    const { service, products, groups } = setup();

    await service.delete("r1", "g1");

    expect(products.removeModifierGroup).toHaveBeenCalledWith("r1", "g1");
    expect(groups.delete).toHaveBeenCalledWith("r1", "g1");
  });

  it("reports missing groups and options", async () => {
    const { service } = setup();

    await expect(service.replace("r1", "g9", { name: "X", minSelect: 0, maxSelect: 1, options })).rejects.toThrow(NotFoundException);
    await expect(service.setOptionAvailability("r1", "g1", "o9", false)).rejects.toMatchObject({
      response: { code: "MODIFIER_OPTION_NOT_FOUND" },
    });
  });
});

describe("MenuService", () => {
  function setup(productsInCategory = 0) {
    const categories = {
      list: jest.fn(async () => [
        { id: "c2", name: "Bebidas", description: "", active: true, position: 0 },
        { id: "c1", name: "Sándwiches", description: "", active: false, position: 1 },
      ]),
      exists: jest.fn(async () => true),
      delete: jest.fn(),
      reorder: jest.fn(),
    };
    const productsRepository = {
      list: jest.fn(async () => [
        product({ id: "p1", categoryId: "c1", position: 0 }),
        product({ id: "p2", categoryId: "c2", position: 1 }),
        product({ id: "p3", categoryId: "c2", position: 0 }),
      ]),
      countInCategory: jest.fn(async () => productsInCategory),
    };
    const products = { toView: (p: ProductRecord) => ({ id: p.id }) };
    const modifierGroups = { list: jest.fn(async () => []) };
    const service = new MenuService(
      categories as unknown as CategoriesRepository,
      productsRepository as unknown as ProductsRepository,
      products as unknown as ProductsService,
      modifierGroups as unknown as ModifierGroupsService,
    );
    return { service, categories };
  }

  it("orders products by category order, then by position", async () => {
    const menu = await setup().service.getAdminMenu("r1");

    expect(menu.products.map((p) => p.id)).toEqual(["p3", "p2", "p1"]);
  });

  it("refuses to delete a category that still has products", async () => {
    await expect(setup(2).service.deleteCategory("r1", "c1")).rejects.toThrow(ConflictException);
  });

  it("reorders categories with the complete set only", async () => {
    const { service, categories } = setup();

    await expect(service.reorderCategories("r1", ["c1"])).rejects.toThrow(BadRequestException);
    await service.reorderCategories("r1", ["c1", "c2"]);
    expect(categories.reorder).toHaveBeenCalledWith("r1", ["c1", "c2"]);
  });
});

describe("PublicMenuService", () => {
  function setup(status: "active" | "suspended" = "active") {
    const restaurants = {
      findBySlug: jest.fn(async () => ({
        id: "r1",
        name: "Sanguchería",
        slug: "sangucheria",
        description: "",
        phone: "",
        currency: "CLP",
        status,
        logoKey: null,
      })),
    };
    const categories = {
      list: jest.fn(async () => [
        { id: "c1", name: "Sándwiches", description: "", active: true, position: 0 },
        { id: "c2", name: "Vacía", description: "", active: true, position: 1 },
      ]),
    };
    const products = { list: jest.fn(async () => [product({ modifierGroupIds: ["g1", "deleted"] })]) };
    const groups = {
      list: jest.fn(async () => [{ id: "g1", name: "Tamaño", minSelect: 1, maxSelect: 1, options: [] }]),
    };
    const service = new PublicMenuService(
      restaurants as unknown as RestaurantsRepository,
      categories as unknown as CategoriesRepository,
      products as unknown as ProductsRepository,
      groups as unknown as ModifierGroupsRepository,
      media,
    );
    return { service, restaurants, categories, products };
  }

  it("asks only for active categories and visible products, and drops empty categories", async () => {
    const { service, categories, products, restaurants } = setup();

    const menu = await service.getBySlug(" Sangucheria ");

    expect(restaurants.findBySlug).toHaveBeenCalledWith("sangucheria");
    expect(categories.list).toHaveBeenCalledWith("r1", { activeOnly: true });
    expect(products.list).toHaveBeenCalledWith("r1", { visibleOnly: true });
    expect(menu.categories.map((c) => c.name)).toEqual(["Sándwiches"]);
    expect(menu.categories[0]!.products[0]!.modifierGroups.map((g) => g.id)).toEqual(["g1"]);
  });

  it("hides suspended restaurants", async () => {
    await expect(setup("suspended").service.getBySlug("sangucheria")).rejects.toMatchObject({
      response: { code: "MENU_NOT_FOUND" },
    });
  });
});
