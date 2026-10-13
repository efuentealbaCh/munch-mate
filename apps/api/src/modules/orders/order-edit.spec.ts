import { applyEdit, checkEdit, lineLabel } from "./order-edit";
import type { PricedItem } from "./order-pricing";

function line(name: string, quantity: number, unitTotal: number, options: string[] = []): PricedItem {
  return {
    productId: `p-${name}`,
    name,
    unitPrice: unitTotal,
    regularUnitPrice: unitTotal,
    promoLabel: "",
    quantity,
    modifiers: options.map((optionName, i) => ({
      groupId: `g${i}`,
      groupName: `Grupo ${i}`,
      optionId: `o${i}`,
      optionName,
      priceDelta: 0,
    })),
    note: "",
    lineTotal: unitTotal * quantity,
  };
}

const pizza = line("Pizza Margarita", 2, 9990, ["Familiar"]);
const completo = line("Completo", 1, 3490);
const items = [pizza, completo];

describe("applyEdit", () => {
  it("keeps the price snapshot of a line and recomputes its total for the new quantity", () => {
    const promo = { ...pizza, unitPrice: 4995, regularUnitPrice: 9990, promoLabel: "2x1", lineTotal: 4995 * 2, note: "sin orégano" };

    const result = applyEdit([promo, completo], [{ line: 0, quantity: 1 }, { line: 1, quantity: 1 }], []);

    expect(result.items[0]).toEqual({ ...promo, quantity: 1, lineTotal: 4995 });
    expect(result.subtotal).toBe(4995 + 3490);
    expect(result.changes).toEqual(["Pizza Margarita (Familiar): 2 → 1"]);
  });

  it("removes the lines not kept", () => {
    const result = applyEdit(items, [{ line: 1, quantity: 1 }], []);

    expect(result.items).toEqual([completo]);
    expect(result.subtotal).toBe(3490);
    expect(result.changes).toEqual(["−2 Pizza Margarita (Familiar)"]);
  });

  it("adds new lines after the kept ones, in their original order", () => {
    const coca = line("Coca-Cola 350 ml", 1, 1500);

    const result = applyEdit(items, [{ line: 1, quantity: 3 }, { line: 0, quantity: 2 }], [coca]);

    expect(result.items.map((i) => i.name)).toEqual(["Pizza Margarita", "Completo", "Coca-Cola 350 ml"]);
    expect(result.subtotal).toBe(9990 * 2 + 3490 * 3 + 1500);
    expect(result.changes).toEqual(["Completo: 1 → 3", "+1 Coca-Cola 350 ml"]);
  });

  it("replaces the whole order", () => {
    const result = applyEdit(items, [], [line("Lomito", 1, 6990)]);

    expect(result.changes).toEqual(["−2 Pizza Margarita (Familiar)", "−1 Completo", "+1 Lomito"]);
    expect(result.subtotal).toBe(6990);
  });
});

describe("checkEdit", () => {
  it.each([
    ["a repeated line", [{ line: 0, quantity: 1 }, { line: 0, quantity: 2 }], 0, "INVALID_EDIT"],
    ["a line out of range", [{ line: 2, quantity: 1 }], 0, "INVALID_EDIT"],
    ["a negative line", [{ line: -1, quantity: 1 }], 0, "INVALID_EDIT"],
    ["an empty order", [], 0, "ORDER_EMPTY"],
    ["no changes", [{ line: 1, quantity: 1 }, { line: 0, quantity: 2 }], 0, "NOTHING_CHANGED"],
  ])("rejects %s", (_, keep, adding, code) => {
    expect(() => checkEdit(items, keep, adding)).toThrow(expect.objectContaining({ code }));
  });

  it("accepts the same lines plus an added one", () => {
    expect(() => checkEdit(items, [{ line: 0, quantity: 2 }, { line: 1, quantity: 1 }], 1)).not.toThrow();
  });
});

describe("lineLabel", () => {
  it("lists the chosen options after the product", () => {
    expect(lineLabel(line("Pizza", 1, 1, ["Familiar", "Extra queso"]))).toBe("Pizza (Familiar, Extra queso)");
    expect(lineLabel(completo)).toBe("Completo");
  });
});
