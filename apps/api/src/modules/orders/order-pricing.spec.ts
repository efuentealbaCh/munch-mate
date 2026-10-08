import { OrderValidationError, type PricingMenu, priceOrder } from "./order-pricing";

function menu(overrides: { productAvailable?: boolean; orderable?: boolean; optionAvailable?: boolean } = {}): PricingMenu {
  return {
    products: new Map([
      [
        "p1",
        {
          id: "p1",
          name: "Completo italiano",
          price: 3490,
          available: overrides.productAvailable ?? true,
          orderable: overrides.orderable ?? true,
          modifierGroupIds: ["size", "extras"],
        },
      ],
      ["p2", { id: "p2", name: "Bebida", price: 1500, available: true, orderable: true, modifierGroupIds: [] }],
    ]),
    groups: new Map([
      [
        "size",
        {
          id: "size",
          name: "Tamaño",
          minSelect: 1,
          maxSelect: 1,
          options: [
            { id: "normal", name: "Normal", priceDelta: 0, available: true },
            { id: "xl", name: "XL", priceDelta: 1500, available: true },
          ],
        },
      ],
      [
        "extras",
        {
          id: "extras",
          name: "Agregados",
          minSelect: 0,
          maxSelect: 2,
          options: [
            { id: "palta", name: "Palta", priceDelta: 800, available: overrides.optionAvailable ?? true },
            { id: "queso", name: "Queso", priceDelta: 700, available: true },
            { id: "tocino", name: "Tocino", priceDelta: 1000, available: true },
          ],
        },
      ],
    ]),
  };
}

const italiano = (modifiers: { groupId: string; optionIds: string[] }[], quantity = 1) => ({
  productId: "p1",
  quantity,
  modifiers,
});

/** Runs priceOrder and returns the error code it throws. */
function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof OrderValidationError) return error.code;
    throw error;
  }
  return undefined;
}

describe("priceOrder", () => {
  it("prices lines with modifiers from the menu, ignoring the client's ordering", () => {
    const result = priceOrder(
      [
        italiano([
          { groupId: "extras", optionIds: ["queso", "palta"] },
          { groupId: "size", optionIds: ["xl"] },
        ], 2),
        { productId: "p2", quantity: 1, modifiers: [], note: "  bien helada  " },
      ],
      menu(),
    );

    expect(result.items[0]).toMatchObject({
      name: "Completo italiano",
      unitPrice: 3490,
      quantity: 2,
      lineTotal: (3490 + 1500 + 800 + 700) * 2,
    });
    expect(result.items[0]!.modifiers.map((m) => m.optionName)).toEqual(["XL", "Palta", "Queso"]);
    expect(result.items[1]).toMatchObject({ lineTotal: 1500, note: "bien helada" });
    expect(result.subtotal).toBe((3490 + 1500 + 800 + 700) * 2 + 1500);
  });

  it("enforces required groups and maximums", () => {
    expect(errorCode(() => priceOrder([italiano([])], menu()))).toBe("INVALID_MODIFIERS");
    expect(
      errorCode(() =>
        priceOrder([italiano([{ groupId: "size", optionIds: ["normal"] }, { groupId: "extras", optionIds: ["palta", "queso", "tocino"] }])], menu()),
      ),
    ).toBe("INVALID_MODIFIERS");
  });

  it("rejects groups or options that do not belong to the product", () => {
    expect(
      errorCode(() => priceOrder([{ productId: "p2", quantity: 1, modifiers: [{ groupId: "size", optionIds: ["xl"] }] }], menu())),
    ).toBe("INVALID_MODIFIERS");
    expect(errorCode(() => priceOrder([italiano([{ groupId: "size", optionIds: ["giant"] }])], menu()))).toBe(
      "INVALID_MODIFIERS",
    );
    expect(errorCode(() => priceOrder([italiano([{ groupId: "size", optionIds: ["xl", "xl"] }])], menu()))).toBe(
      "INVALID_MODIFIERS",
    );
  });

  it("rejects sold-out products and options, and products no longer on the menu", () => {
    const base = [{ groupId: "size", optionIds: ["normal"] }];
    expect(errorCode(() => priceOrder([italiano(base)], menu({ productAvailable: false })))).toBe("PRODUCT_SOLD_OUT");
    expect(errorCode(() => priceOrder([italiano(base)], menu({ orderable: false })))).toBe("PRODUCT_NOT_AVAILABLE");
    expect(errorCode(() => priceOrder([{ productId: "ghost", quantity: 1, modifiers: [] }], menu()))).toBe(
      "PRODUCT_NOT_AVAILABLE",
    );
    expect(
      errorCode(() => priceOrder([italiano([...base, { groupId: "extras", optionIds: ["palta"] }])], menu({ optionAvailable: false }))),
    ).toBe("OPTION_SOLD_OUT");
  });
});
