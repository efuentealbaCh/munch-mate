import { equalPartAmount } from "@app/utils";
import type { OrderRecord } from "./orders.repository";
import type { TablePaymentRecord } from "./table-sessions.repository";
import {
  allocatePayments,
  dueOrders,
  itemLines,
  itemsAmount,
  mainMethod,
  methodsOf,
  paidEqualParts,
  paidQuantities,
  remaining,
  SplitError,
} from "./table-split";

let seq = 0;
function order(overrides: Partial<OrderRecord>): OrderRecord {
  seq++;
  return {
    id: `o${seq}`,
    restaurantId: "r1",
    number: seq,
    ticketNumber: seq,
    businessDate: "2026-10-13",
    channel: "dine_in",
    status: "served",
    statusHistory: [],
    paymentStatus: "unpaid",
    paymentMethod: null,
    paymentBreakdown: [],
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    currency: "CLP",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    note: "",
    tableId: "t1",
    tableLabel: "Mesa 4",
    tableSessionId: "s1",
    notifyBy: null,
    estimatedReadyAt: null,
    delivery: null,
    expectedPayment: null,
    riderId: null,
    riderName: null,
    customerId: null,
    clientOrderId: `c${seq}`,
    revision: 0,
    edits: [],
    createdAt: new Date(Date.UTC(2026, 9, 13, 20, seq)),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A line of `quantity` units at `unit` each (options included). */
const line = (name: string, quantity: number, unit: number) => ({
  productId: "p1",
  name,
  unitPrice: unit,
  regularUnitPrice: unit,
  promoLabel: "",
  quantity,
  note: "",
  lineTotal: unit * quantity,
  modifiers: [],
});

/** An order whose total is the sum of its lines. */
const withLines = (lines: ReturnType<typeof line>[], overrides: Partial<OrderRecord> = {}) =>
  order({ items: lines, subtotal: lines.reduce((s, l) => s + l.lineTotal, 0), total: lines.reduce((s, l) => s + l.lineTotal, 0), ...overrides });

let paymentSeq = 0;
const payment = (over: Partial<TablePaymentRecord>): TablePaymentRecord => ({
  id: `pay${++paymentSeq}`,
  kind: "amount",
  amount: 0,
  tip: 0,
  method: "cash",
  part: null,
  items: [],
  at: new Date(),
  byUserId: "w1",
  byName: "Gabi",
  ...over,
});

const sumOf = (portions: { amount: number }[] | undefined) => (portions ?? []).reduce((s, p) => s + p.amount, 0);

describe("remaining", () => {
  it("is the orders due minus the payments, leaving out rejected, cancelled and already paid orders", () => {
    const orders = [
      order({ total: 10_000 }),
      order({ total: 5000, status: "preparing" }),
      order({ total: 9000, status: "cancelled" }),
      order({ total: 9000, status: "rejected" }),
      order({ total: 2000, paymentStatus: "paid", paymentMethod: "cash" }),
    ];
    expect(dueOrders(orders).map((o) => o.total)).toEqual([10_000, 5000]);
    expect(remaining(orders, [])).toBe(15_000);
    expect(remaining(orders, [payment({ amount: 4000 }), payment({ amount: 1000 })])).toBe(10_000);
  });

  it("goes negative when an order is cancelled after it was paid for", () => {
    const orders = [order({ total: 3000 }), order({ total: 2000, status: "cancelled" })];
    expect(remaining(orders, [payment({ amount: 5000 })])).toBe(-2000);
  });

  it("grows with a new order, and the equal parts still pending absorb it", () => {
    const first = [order({ total: 20_000 })];
    const paid = [payment({ kind: "equal", part: 1, amount: equalPartAmount(remaining(first, []), 4, 0) })];
    expect(paid[0]!.amount).toBe(5000);
    const later = [...first, order({ total: 3000 })];
    expect(remaining(later, paid)).toBe(18_000);
    expect(equalPartAmount(remaining(later, paid), 4, paidEqualParts(paid).length)).toBe(6000);
  });
});

describe("paidQuantities and paidEqualParts", () => {
  it("adds up the units paid per line across payments, and lists the equal parts paid", () => {
    const payments = [
      payment({ kind: "items", items: [{ orderId: "o1", line: 0, quantity: 1 }, { orderId: "o1", line: 1, quantity: 2 }] }),
      payment({ kind: "items", items: [{ orderId: "o1", line: 0, quantity: 1 }] }),
      payment({ kind: "equal", part: 3 }),
      payment({ kind: "amount" }),
    ];
    expect([...paidQuantities(payments)]).toEqual([
      ["o1:0", 2],
      ["o1:1", 2],
    ]);
    expect(paidEqualParts(payments)).toEqual([3]);
  });
});

describe("itemsAmount", () => {
  const a = withLines([line("Pizza", 2, 12_000), line("Bebida", 3, 1990)]);
  const b = withLines([line("Café", 1, 2500)]);
  const orders = [a, b];

  it("prices the chosen units of each line, adding repeated lines", () => {
    expect(
      itemsAmount(orders, [], [
        { orderId: a.id, line: 0, quantity: 1 },
        { orderId: a.id, line: 1, quantity: 2 },
        { orderId: b.id, line: 0, quantity: 1 },
      ]),
    ).toBe(12_000 + 3980 + 2500);
    expect(
      itemsAmount(orders, [], [
        { orderId: a.id, line: 1, quantity: 1 },
        { orderId: a.id, line: 1, quantity: 2 },
      ]),
    ).toBe(5970);
  });

  it("allows only the units left unpaid of a partly paid line", () => {
    const paid = [payment({ kind: "items", items: [{ orderId: a.id, line: 1, quantity: 2 }] })];
    expect(itemsAmount(orders, paid, [{ orderId: a.id, line: 1, quantity: 1 }])).toBe(1990);
    expect(() => itemsAmount(orders, paid, [{ orderId: a.id, line: 1, quantity: 2 }])).toThrow(SplitError);
    expect(() =>
      itemsAmount(orders, paid, [
        { orderId: a.id, line: 1, quantity: 1 },
        { orderId: a.id, line: 1, quantity: 1 },
      ]),
    ).toThrow("Quedan menos unidades por pagar de Bebida");
  });

  it.each([
    ["an unknown line", { orderId: "o-x", line: 0, quantity: 1 }],
    ["a line index out of range", { orderId: a.id, line: 5, quantity: 1 }],
    ["a zero quantity", { orderId: a.id, line: 0, quantity: 0 }],
    ["more units than the line has", { orderId: b.id, line: 0, quantity: 2 }],
  ])("rejects %s", (_, item) => {
    expect(() => itemsAmount(orders, [], [item])).toThrow(SplitError);
  });

  it("rejects an empty selection and lines of orders that are not due", () => {
    expect(() => itemsAmount(orders, [], [])).toThrow(SplitError);
    const cancelled = withLines([line("Pizza", 1, 12_000)], { status: "cancelled" });
    const paidAlone = withLines([line("Pizza", 1, 12_000)], { paymentStatus: "paid", paymentMethod: "cash" });
    expect(() => itemsAmount([cancelled], [], [{ orderId: cancelled.id, line: 0, quantity: 1 }])).toThrow(SplitError);
    expect(() => itemsAmount([paidAlone], [], [{ orderId: paidAlone.id, line: 0, quantity: 1 }])).toThrow(SplitError);
    try {
      itemsAmount(orders, [], []);
    } catch (error) {
      expect((error as SplitError).code).toBe("INVALID_SPLIT_ITEMS");
    }
  });
});

describe("itemLines", () => {
  it("lists every line per order (not grouped), oldest order first, with the units paid", () => {
    const a = withLines([line("Pizza", 2, 12_000)]);
    const cancelled = withLines([line("Torta", 1, 4000)], { status: "cancelled" });
    const b = withLines([line("Pizza", 1, 12_000)]);
    const lines = itemLines([b, cancelled, a], [payment({ kind: "items", items: [{ orderId: a.id, line: 0, quantity: 1 }] })]);
    expect(lines).toEqual([
      { orderId: a.id, line: 0, name: "Pizza", options: [], quantity: 2, paidQuantity: 1, unitAmount: 12_000, total: 24_000 },
      { orderId: b.id, line: 0, name: "Pizza", options: [], quantity: 1, paidQuantity: 0, unitAmount: 12_000, total: 12_000 },
    ]);
  });
});

describe("methodsOf and mainMethod", () => {
  it("lists the methods in order of first use and picks the largest portion (first on ties)", () => {
    expect(methodsOf([payment({ method: "card_pos" }), payment({ method: "cash" }), payment({ method: "card_pos" })])).toEqual([
      "card_pos",
      "cash",
    ]);
    expect(mainMethod([{ method: "cash", amount: 3000 }, { method: "transfer", amount: 7000 }])).toBe("transfer");
    expect(mainMethod([{ method: "cash", amount: 5000 }, { method: "card_pos", amount: 5000 }])).toBe("cash");
    expect(mainMethod([])).toBeNull();
  });
});

describe("allocatePayments", () => {
  it("fills the orders oldest first, splitting a payment between orders and merging the same method", () => {
    const a = order({ total: 10_000 });
    const b = order({ total: 6000 });
    const shares = allocatePayments(
      [b, a],
      [
        payment({ amount: 8000, method: "cash" }),
        payment({ amount: 5000, method: "card_pos" }),
        payment({ amount: 3000, method: "cash" }),
      ],
    );
    expect(shares.get(a.id)).toEqual([
      { method: "cash", amount: 8000 },
      { method: "card_pos", amount: 2000 },
    ]);
    expect(shares.get(b.id)).toEqual([
      { method: "card_pos", amount: 3000 },
      { method: "cash", amount: 3000 },
    ]);
  });

  it("gives each order exactly its total when the payments add up to the bill, with odd equal parts", () => {
    const orders = [order({ total: 3333 }), order({ total: 3335 }), order({ total: 3333 })];
    let left = remaining(orders, []);
    const payments: TablePaymentRecord[] = [];
    const methods = ["cash", "card_pos", "transfer"] as const;
    for (let part = 1; part <= 3; part++) {
      const amount = equalPartAmount(left, 3, part - 1);
      payments.push(payment({ kind: "equal", part, amount, method: methods[part - 1]! }));
      left -= amount;
    }
    expect(left).toBe(0);
    const shares = allocatePayments(orders, payments);
    for (const o of orders) expect(sumOf(shares.get(o.id))).toBe(o.total);
  });

  it("assigns payments by products to the orders of their lines first", () => {
    const a = withLines([line("Pizza", 1, 12_000)]);
    const b = withLines([line("Café", 2, 2500)]);
    const shares = allocatePayments(
      [a, b],
      [
        payment({ kind: "items", amount: 5000, method: "card_pos", items: [{ orderId: b.id, line: 0, quantity: 2 }] }),
        payment({ kind: "amount", amount: 12_000, method: "cash" }),
      ],
    );
    expect(shares.get(a.id)).toEqual([{ method: "cash", amount: 12_000 }]);
    expect(shares.get(b.id)).toEqual([{ method: "card_pos", amount: 5000 }]);
  });

  it("leaves out orders not due, sends what a cancelled order's lines paid to the others, and gives 0-total orders nothing", () => {
    const cancelled = withLines([line("Torta", 1, 4000)], { status: "cancelled" });
    const paidAlone = withLines([line("Jugo", 1, 2000)], { paymentStatus: "paid", paymentMethod: "cash" });
    const free = withLines([line("Agua", 1, 0)]);
    const due = withLines([line("Lomo", 1, 4000)]);
    const shares = allocatePayments(
      [cancelled, paidAlone, free, due],
      [payment({ kind: "items", amount: 4000, method: "transfer", items: [{ orderId: cancelled.id, line: 0, quantity: 1 }] })],
    );
    expect([...shares.keys()]).toEqual([free.id, due.id]);
    expect(shares.get(free.id)).toEqual([]);
    expect(shares.get(due.id)).toEqual([{ method: "transfer", amount: 4000 }]);
  });

  it("adds up exactly with every kind of payment mixed", () => {
    const a = withLines([line("Pizza", 2, 11_990), line("Bebida", 3, 1990)]);
    const b = withLines([line("Café", 3, 2490)]);
    const c = withLines([line("Torta", 1, 4990)]);
    const orders = [a, b, c];
    const payments = [
      payment({ kind: "items", amount: 11_990 + 2490, method: "card_pos", items: [{ orderId: a.id, line: 0, quantity: 1 }, { orderId: b.id, line: 0, quantity: 1 }] }),
      payment({ kind: "amount", amount: 7777, method: "transfer" }),
    ];
    payments.push(payment({ kind: "amount", amount: remaining(orders, payments), method: "cash" }));
    expect(remaining(orders, payments)).toBe(0);
    const shares = allocatePayments(orders, payments);
    for (const o of orders) expect(sumOf(shares.get(o.id))).toBe(o.total);
    expect([...shares.values()].flat().reduce((s, p) => s + p.amount, 0)).toBe(payments.reduce((s, p) => s + p.amount, 0));
  });
});
