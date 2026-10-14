import type { ProductPromo } from "@app/types";
import { type PricingMenu, priceOrder } from "./order-pricing";

// Tuesday 13-10-2026, 13:00 in Santiago.
const TUESDAY = { at: new Date("2026-10-13T16:00:00Z"), timeZone: "America/Santiago" };

function menu(promo: ProductPromo | null): PricingMenu {
  return {
    products: new Map([
      ["p1", { id: "p1", name: "Completo italiano", price: 3490, available: true, orderable: true, modifierGroupIds: ["size"], promo }],
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
    ]),
  };
}

const line = (option: string, quantity = 1) => ({ productId: "p1", quantity, modifiers: [{ groupId: "size", optionIds: [option] }] });
const promo = (over: Partial<ProductPromo>): ProductPromo => ({
  kind: "percent",
  value: 20,
  days: [],
  startsOn: null,
  endsOn: null,
  label: "",
  ...over,
});

describe("priceOrder with discounts (phase 8)", () => {
  it("charges the discounted base price, keeps the regular one and charges extras in full", () => {
    const priced = priceOrder([line("xl", 2)], menu(promo({})), TUESDAY);
    expect(priced.items[0]).toMatchObject({
      unitPrice: 2792,
      regularUnitPrice: 3490,
      promoLabel: "20 % dcto.",
      lineTotal: (2792 + 1500) * 2,
    });
    expect(priced.subtotal).toBe(8584);
  });

  it("uses the regular price on days the discount does not apply", () => {
    const priced = priceOrder([line("normal")], menu(promo({ kind: "price", value: 2990, days: [4], label: "Viernes" })), TUESDAY);
    expect(priced.items[0]).toMatchObject({ unitPrice: 3490, regularUnitPrice: 3490, promoLabel: "" });
  });

  it("applies a special price with its label inside its dates", () => {
    const priced = priceOrder(
      [line("normal")],
      menu(promo({ kind: "price", value: 2990, days: [1], startsOn: "2026-10-01", endsOn: "2026-10-31", label: "Martes de completos" })),
      TUESDAY,
    );
    expect(priced.items[0]).toMatchObject({ unitPrice: 2990, regularUnitPrice: 3490, promoLabel: "Martes de completos" });
  });

  it("prices without a discount exactly as before", () => {
    const priced = priceOrder([line("normal")], menu(null), TUESDAY);
    expect(priced.items[0]).toMatchObject({ unitPrice: 3490, regularUnitPrice: 3490, promoLabel: "", lineTotal: 3490 });
  });
});
