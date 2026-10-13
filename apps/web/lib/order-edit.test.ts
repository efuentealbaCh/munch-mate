import type { OrderItemView, OrderView } from "@app/types";
import { describe, expect, it } from "vitest";
import type { CartLine } from "./cart";
import {
  canModifyOrder,
  draftLimit,
  draftSubtotal,
  editInput,
  editStaleReason,
  hasDraftChanges,
  initialDraft,
  isDraftEmpty,
  keptLineTotal,
  setKeptQuantity,
} from "./order-edit";

function item(name: string, quantity: number, lineTotal: number): OrderItemView {
  return {
    productId: `p-${name}`,
    name,
    unitPrice: lineTotal / quantity,
    regularUnitPrice: lineTotal / quantity,
    promoLabel: "",
    quantity,
    modifiers: [],
    note: "",
    lineTotal,
  };
}

const order = { items: [item("Pizza", 2, 20000), item("Bebida", 1, 2000)], revision: 3 } as Pick<OrderView, "items" | "revision">;

const soda: CartLine = {
  key: "p-jugo||",
  productId: "p-jugo",
  name: "Jugo",
  basePrice: 2500,
  modifiers: [{ groupId: "g1", groupName: "Sabor", optionId: "o1", optionName: "Frambuesa", priceDelta: 500 }],
  note: "Sin hielo",
  quantity: 2,
};

describe("who sees «Modificar»", () => {
  it("only before the kitchen starts, unpaid, and to the roles that work the channel", () => {
    const base = { status: "accepted", paymentStatus: "unpaid", channel: "dine_in" } as const;
    expect(canModifyOrder(base, ["kitchen"])).toBe(true);
    expect(canModifyOrder({ ...base, status: "pending" }, ["waiter"])).toBe(true);
    expect(canModifyOrder({ ...base, status: "preparing" }, ["owner"])).toBe(false);
    expect(canModifyOrder({ ...base, paymentStatus: "paid" }, ["owner"])).toBe(false);
    expect(canModifyOrder({ ...base, channel: "pickup" }, ["waiter"])).toBe(false);
    expect(canModifyOrder({ ...base, channel: "delivery" }, ["rider"])).toBe(false);
  });
});

describe("edit draft", () => {
  it("starts as the order is, with nothing to save", () => {
    const draft = initialDraft(order);
    expect(draft).toEqual({ quantities: [2, 1], added: [] });
    expect(hasDraftChanges(order, draft)).toBe(false);
    expect(draftSubtotal(order, draft)).toBe(22000);
  });

  it("keeps the snapshot price of kept lines and prices added ones like the cart", () => {
    expect(keptLineTotal(item("Pizza", 2, 20000), 3)).toBe(30000);
    const draft = { ...setKeptQuantity(initialDraft(order), 0, 1), added: [soda] };
    // 1 × 10.000 + 1 × 2.000 + 2 × (2.500 + 500).
    expect(draftSubtotal(order, draft)).toBe(18000);
    expect(hasDraftChanges(order, draft)).toBe(true);
  });

  it("bounds quantities and detects an emptied order", () => {
    let draft = setKeptQuantity(initialDraft(order), 0, 99);
    expect(draft.quantities[0]).toBe(20);
    draft = setKeptQuantity(setKeptQuantity(draft, 0, 0), 1, -1);
    expect(draft.quantities).toEqual([0, 0]);
    expect(isDraftEmpty(draft)).toBe(true);
    expect(isDraftEmpty({ ...draft, added: [soda] })).toBe(false);
  });

  it("counts units against the restaurant's cap", () => {
    const draft = { ...initialDraft(order), added: [soda] };
    expect(draftLimit(draft, 5)).toEqual({ max: 5, count: 5, remaining: 0, exceeded: false });
    expect(draftLimit(draft, 4).exceeded).toBe(true);
  });

  it("sends kept lines by index, the added ones as ids, and a cleaned reason only when present", () => {
    const draft = { ...setKeptQuantity(initialDraft(order), 1, 0), added: [soda] };
    expect(editInput(order.revision, draft, "  ")).toEqual({
      revision: 3,
      keep: [{ line: 0, quantity: 2 }],
      add: [{ productId: "p-jugo", quantity: 2, modifiers: [{ groupId: "g1", optionIds: ["o1"] }], note: "Sin hielo" }],
    });
    expect(editInput(order.revision, draft, "  El cliente​   cambió de idea ").reason).toBe("El cliente cambió de idea");
    expect(editInput(order.revision, draft, "x".repeat(250)).reason).toHaveLength(200);
  });
});

describe("the order changed while the dialog was open", () => {
  const opened = { revision: 3 };
  it("can still save while it is the same order, editable and unpaid", () => {
    expect(editStaleReason(opened, { status: "accepted", paymentStatus: "unpaid", revision: 3 })).toBeNull();
  });

  it("says why it cannot", () => {
    expect(editStaleReason(opened, undefined)).toMatch(/ya no está en curso/);
    expect(editStaleReason(opened, { status: "preparing", paymentStatus: "unpaid", revision: 3 })).toBe(
      "Este pedido cambió a «En preparación»: ya no se puede modificar.",
    );
    expect(editStaleReason(opened, { status: "accepted", paymentStatus: "paid", revision: 3 })).toMatch(/pagado/);
    expect(editStaleReason(opened, { status: "accepted", paymentStatus: "unpaid", revision: 4 })).toMatch(/alguien más lo modificó/);
  });
});
