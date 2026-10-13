import type { MediaService } from "../../infra/storage/media.service";
import type { CategoriesRepository } from "./categories.repository";
import type { ModifierGroupsRepository } from "./modifier-groups.repository";
import type { ProductRecord, ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";

const product = (overrides: Partial<ProductRecord> = {}): ProductRecord => ({
  id: "p1",
  categoryId: "c1",
  name: "Pizza Margarita",
  description: "",
  price: 8990,
  available: true,
  visible: true,
  imageKey: null,
  modifierGroupIds: [],
  position: 0,
  promo: null,
  ...overrides,
});

function setup(current: ProductRecord | null = product()) {
  const products = {
    findOne: jest.fn(async () => current),
    list: jest.fn(async () => (current ? [current] : [])),
    setPromo: jest.fn(async (_r: string, _p: string, promo: ProductRecord["promo"]) => (current ? { ...current, promo } : null)),
    update: jest.fn(async (_r: string, _p: string, changes: Partial<ProductRecord>) => ({ ...current!, ...changes })),
  };
  const service = new ProductsService(
    products as unknown as ProductsRepository,
    { exists: jest.fn(async () => true) } as unknown as CategoriesRepository,
    { existingIds: jest.fn(async () => new Set()) } as unknown as ModifierGroupsRepository,
    { productImage: () => null } as unknown as MediaService,
  );
  return { service, products };
}

describe("ProductsService discounts (phase 8)", () => {
  it("stores a discount with its days sorted and defaults filled in", async () => {
    const { service, products } = setup();
    const view = await service.setPromo("r1", "p1", { kind: "percent", value: 20, days: [3, 1] });
    expect(products.setPromo).toHaveBeenCalledWith("r1", "p1", {
      kind: "percent",
      value: 20,
      days: [1, 3],
      startsOn: null,
      endsOn: null,
      label: "",
    });
    expect(view.promo).toMatchObject({ kind: "percent", value: 20 });
  });

  it("rejects a special price not lower than the regular one, and dates in the wrong order", async () => {
    await expect(setup().service.setPromo("r1", "p1", { kind: "price", value: 8990 })).rejects.toMatchObject({
      response: { code: "INVALID_PROMO", meta: { problem: "price_not_lower" } },
    });
    await expect(
      setup().service.setPromo("r1", "p1", { kind: "percent", value: 10, startsOn: "2026-10-31", endsOn: "2026-10-01" }),
    ).rejects.toMatchObject({ response: { code: "INVALID_PROMO", meta: { problem: "date_order" } } });
  });

  it("answers 404 for products of other restaurants", async () => {
    await expect(setup(null).service.setPromo("r1", "p1", { kind: "percent", value: 10 })).rejects.toMatchObject({
      response: { code: "PRODUCT_NOT_FOUND" },
    });
  });

  it("does not let a price change turn a special price into a surcharge", async () => {
    const withSpecial = product({ promo: { kind: "price", value: 5990, days: [], startsOn: null, endsOn: null, label: "" } });
    await expect(setup(withSpecial).service.update("r1", "p1", { price: 5990 })).rejects.toMatchObject({
      response: { code: "PROMO_PRICE_NOT_LOWER" },
    });
    await expect(setup(withSpecial).service.update("r1", "p1", { price: 6990 })).resolves.toMatchObject({ price: 6990 });
  });
});
