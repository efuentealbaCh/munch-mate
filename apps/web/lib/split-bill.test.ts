import type { BillItemLine, OrderView, TablePaymentView, TableSessionView } from "@app/types";
import { describe, expect, it } from "vitest";
import { preBillTicket } from "./print";
import {
  amountFromInput,
  equalPartRows,
  linePaidLabel,
  minSplitParts,
  modeOfSplit,
  paidItemsDetail,
  paymentBadgeLabel,
  pendingPartsLabel,
  publicPaymentLabel,
  selectionSummary,
  splitChipLabel,
  splitInputFor,
  splitPlanLabel,
  suggestedPaymentTip,
} from "./split-bill";

const payment = (over: Partial<TablePaymentView>): TablePaymentView => ({
  id: "p1",
  kind: "amount",
  amount: 1000,
  tip: 0,
  method: "cash",
  part: null,
  itemCount: 0,
  items: [],
  at: "2026-10-13T20:00:00.000Z",
  byName: "Gabi",
  ...over,
});

const session = (over: Partial<TableSessionView> = {}): TableSessionView => ({
  id: "s1",
  tableId: "t1",
  tableLabel: "Mesa 4",
  status: "open",
  openedAt: "2026-10-13T19:00:00.000Z",
  closedAt: null,
  lines: [{ name: "Lomo", options: [], quantity: 1, paidQuantity: 0, total: 10000 }],
  orderIds: ["o1"],
  orderCount: 1,
  ordersInProgress: 0,
  unpaidOrders: 1,
  subtotal: 10000,
  currency: "CLP",
  tipPercent: 10,
  suggestedTip: 1000,
  waiterCalledAt: null,
  billRequestedAt: null,
  requestedTip: null,
  tip: null,
  paymentMethod: null,
  paymentMethods: [],
  closedByName: null,
  split: null,
  payments: [],
  paid: 0,
  remaining: 10000,
  itemLines: [],
  equalPart: null,
  ...over,
});

const line = (over: Partial<BillItemLine>): BillItemLine => ({
  orderId: "o1",
  line: 0,
  name: "Lasaña",
  options: [],
  quantity: 2,
  paidQuantity: 0,
  unitAmount: 8000,
  total: 16000,
  ...over,
});

describe("split plan", () => {
  it("maps plans to the dialog's modes and saves only real changes", () => {
    expect(modeOfSplit(null)).toBe("all");
    expect(modeOfSplit({ mode: "equal", parts: 3 })).toBe("equal");
    expect(splitInputFor("all", null)).toBeNull();
    expect(splitInputFor("all", { mode: "items" })).toEqual({ mode: null });
    expect(splitInputFor("equal", null)).toEqual({ mode: "equal", parts: 2 });
    expect(splitInputFor("equal", { mode: "equal", parts: 4 })).toBeNull();
    expect(splitInputFor("items", { mode: "equal", parts: 4 })).toEqual({ mode: "items" });
    expect(splitInputFor("amounts", null)).toEqual({ mode: "amounts" });
  });

  it("never offers fewer parts than the ones already paid", () => {
    expect(minSplitParts([])).toBe(2);
    expect(minSplitParts([payment({ kind: "equal", part: 1 }), payment({ kind: "equal", part: 2 }), payment({ kind: "amount" })])).toBe(3);
    // Part 4 of 4 paid: the plan cannot drop to 3 parts, where it would fall outside.
    expect(minSplitParts([payment({ kind: "equal", part: 4 })])).toBe(4);
  });
});

describe("equal parts", () => {
  it("previews each pending part, the last one taking the rounding difference", () => {
    const rows = equalPartRows(session({ split: { mode: "equal", parts: 3 } }));
    expect(rows).toEqual([
      { part: 1, status: "pending", amount: 3333 },
      { part: 2, status: "pending", amount: 3333 },
      { part: 3, status: "pending", amount: 3334 },
    ]);
  });

  it("shows the paid parts with their payment and spreads what is left over the rest", () => {
    const paid = payment({ id: "p2", kind: "equal", part: 2, amount: 3333 });
    const rows = equalPartRows(session({ split: { mode: "equal", parts: 3 }, payments: [paid], paid: 3333, remaining: 6667 }));
    expect(rows).toEqual([
      { part: 1, status: "pending", amount: 3333 },
      { part: 2, status: "paid", payment: paid },
      { part: 3, status: "pending", amount: 3334 },
    ]);
    expect(equalPartRows(session({ split: { mode: "items" } }))).toEqual([]);
  });
});

describe("pay by products", () => {
  const lines = [line({}), line({ orderId: "o2", line: 1, name: "Bebida", quantity: 3, paidQuantity: 2, unitAmount: 1500, total: 4500 })];

  it("adds up the selection, capping units someone else already paid", () => {
    expect(selectionSummary(lines, { "o1:0": 1, "o2:1": 3, "o9:0": 2 })).toEqual({
      items: [
        { orderId: "o1", line: 0, quantity: 1 },
        { orderId: "o2", line: 1, quantity: 1 },
      ],
      units: 2,
      amount: 9500,
    });
    expect(selectionSummary(lines, {})).toEqual({ items: [], units: 0, amount: 0 });
  });

  it("describes what a payment covered and lines partly paid", () => {
    expect(paidItemsDetail(payment({ kind: "items", items: [{ orderId: "o1", line: 0, quantity: 2 }, { orderId: "gone", line: 0, quantity: 1 }] }), lines)).toBe(
      "2 × Lasaña",
    );
    expect(linePaidLabel({ quantity: 2, paidQuantity: 1 })).toBe("1 de 2 pagado");
    expect(linePaidLabel({ quantity: 2, paidQuantity: 2 })).toBeNull();
    expect(linePaidLabel({ quantity: 2, paidQuantity: 0 })).toBeNull();
  });
});

describe("free amounts", () => {
  it("accepts whole amounts from 1 to what is left", () => {
    expect(amountFromInput("5.000", 12000, "CLP")).toEqual({ amount: 5000, problem: null });
    expect(amountFromInput("12000", 12000, "CLP")).toEqual({ amount: 12000, problem: null });
    expect(amountFromInput("", 12000, "CLP").problem).toBe("Escribe el monto");
    expect(amountFromInput("3,5", 12000, "CLP").problem).toMatch(/válido/);
    expect(amountFromInput("0", 12000, "CLP").problem).toMatch(/mayor/);
    expect(amountFromInput("12.001", 12000, "CLP").problem).toBe("No puede superar lo que falta ($12.000)");
  });
});

describe("tips per payment", () => {
  it("starts everything-at-once with the table's choice, minus tips already charged", () => {
    expect(suggestedPaymentTip(session({ requestedTip: 1500 }), "all", 10000)).toBe(1500);
    expect(suggestedPaymentTip(session(), "all", 10000)).toBe(1000);
    const paidHalf = { payments: [payment({ amount: 5000, tip: 500 })], paid: 5000, remaining: 5000 };
    expect(suggestedPaymentTip(session({ ...paidHalf, requestedTip: 1500 }), "all", 5000)).toBe(1000);
    expect(suggestedPaymentTip(session(paidHalf), "all", 5000)).toBe(500);
  });

  it("spreads the table's tip over equal parts, and suggests the % of other payments", () => {
    const equal = session({ split: { mode: "equal", parts: 3 }, requestedTip: 1000 });
    expect(suggestedPaymentTip(equal, "equal", 3333)).toBe(333);
    const lastPart = session({
      split: { mode: "equal", parts: 3 },
      requestedTip: 1000,
      payments: [payment({ kind: "equal", part: 1, amount: 3333, tip: 333 }), payment({ id: "p2", kind: "equal", part: 2, amount: 3333, tip: 0 })],
      remaining: 3334,
    });
    expect(suggestedPaymentTip(lastPart, "equal", 3334)).toBe(667);
    expect(suggestedPaymentTip(session({ split: { mode: "equal", parts: 2 } }), "equal", 5000)).toBe(500);
    expect(suggestedPaymentTip(session({ requestedTip: 2000 }), "items", 8000)).toBe(800);
    expect(suggestedPaymentTip(session({ tipPercent: 0 }), "amount", 8000)).toBe(0);
  });
});

describe("labels", () => {
  it("lists payments on the table's phone without names", () => {
    expect(publicPaymentLabel({ kind: "equal", part: 1, amount: 12000, method: "cash", itemCount: 0 }, "CLP")).toBe("Parte 1 · Efectivo · $12.000");
    expect(publicPaymentLabel({ kind: "items", part: null, amount: 8500, method: "card_pos", itemCount: 3 }, "CLP")).toBe(
      "3 productos · Tarjeta (POS) · $8.500",
    );
    expect(publicPaymentLabel({ kind: "amount", part: null, amount: 5000, method: "transfer", itemCount: 0 }, "CLP")).toBe(
      "Pago · Transferencia · $5.000",
    );
  });

  it("names the plan on the floor and on the phone", () => {
    expect(splitChipLabel(null)).toBeNull();
    expect(splitChipLabel({ mode: "equal", parts: 4 })).toBe("4 partes");
    expect(splitChipLabel({ mode: "items" })).toBe("Por productos");
    expect(splitPlanLabel({ mode: "equal", parts: 4 }, { amount: 5000, pendingParts: [1, 2, 3, 4] }, "CLP")).toBe(
      "Dividida en 4 partes de $5.000",
    );
    expect(splitPlanLabel({ mode: "amounts" }, null, "CLP")).toBe("Dividida en montos libres");
    expect(pendingPartsLabel({ amount: 5000, pendingParts: [3, 4] }, "CLP")).toBe("Faltan las partes 3 y 4 de $5.000");
    expect(pendingPartsLabel({ amount: 5000, pendingParts: [1, 3, 4] }, "CLP")).toBe("Faltan las partes 1, 3 y 4 de $5.000");
    expect(pendingPartsLabel({ amount: 5001, pendingParts: [4] }, "CLP")).toBe("Falta la parte 4 de $5.001");
    expect(pendingPartsLabel({ amount: 0, pendingParts: [] }, "CLP")).toBeNull();
  });

  it("shows every portion of an order paid by a split account on the board", () => {
    const order = { currency: "CLP", paymentMethod: "cash", paymentBreakdown: [] } as Pick<OrderView, "currency" | "paymentMethod" | "paymentBreakdown">;
    expect(paymentBadgeLabel(order)).toBe("Pagado · Efectivo");
    expect(paymentBadgeLabel({ ...order, paymentMethod: null })).toBe("Pagado");
    expect(
      paymentBadgeLabel({
        ...order,
        paymentBreakdown: [
          { method: "cash", amount: 8000 },
          { method: "card_pos", amount: 4000 },
        ],
      }),
    ).toBe("Pagado · Dividido (Efectivo $8.000 · Tarjeta (POS) $4.000)");
  });
});

describe("pre-bill of a split account", () => {
  it("adds the plan, each payment and what is left", () => {
    const ticket = preBillTicket(
      session({
        tipPercent: 0,
        suggestedTip: 0,
        split: { mode: "equal", parts: 4 },
        payments: [payment({ kind: "equal", part: 1, amount: 2500, method: "cash" })],
        paid: 2500,
        remaining: 7500,
      }),
      "Forno Rosso",
      new Date("2026-10-13T20:00:00Z"),
    );
    expect(ticket.totals.map((t) => `${t.label}: ${t.amount}`)).toEqual([
      "Consumo: $10.000",
      "Total: $10.000",
      "Faltan 3 de 4 partes de: $2.500",
      "Pagado: Parte 1 · Efectivo: $2.500",
      "Falta: $7.500",
    ]);
    const unsplit = preBillTicket(session({ tipPercent: 0, suggestedTip: 0 }), "Forno Rosso");
    expect(unsplit.totals.map((t) => t.label)).toEqual(["Consumo", "Total"]);
    const fresh = preBillTicket(session({ tipPercent: 0, suggestedTip: 0, split: { mode: "equal", parts: 4 } }), "Forno Rosso");
    expect(fresh.totals.at(-1)).toEqual({ label: "4 partes de", amount: "$2.500" });
  });
});
