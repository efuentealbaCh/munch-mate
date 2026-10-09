import { summarizeDay } from "./daily-summary";
import type { OrderRecord } from "./orders.repository";

function order(overrides: Partial<OrderRecord>): OrderRecord {
  return {
    id: "o",
    restaurantId: "r1",
    number: 1,
    ticketNumber: 1,
    businessDate: "2026-10-08",
    channel: "dine_in",
    status: "served",
    statusHistory: [],
    paymentStatus: "unpaid",
    paymentMethod: null,
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    currency: "CLP",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    note: "",
    tableId: null,
    tableLabel: null,
    estimatedReadyAt: null,
    delivery: null,
    expectedPayment: null,
    riderId: null,
    riderName: null,
    clientOrderId: "c",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const line = (productId: string, name: string, quantity: number, lineTotal: number) => ({
  productId,
  name,
  unitPrice: lineTotal / quantity,
  quantity,
  modifiers: [],
  note: "",
  lineTotal,
});

describe("summarizeDay", () => {
  it("sums sales per channel and payment method, leaving rejected and cancelled orders out", () => {
    const summary = summarizeDay(
      [
        order({ total: 7000, paymentStatus: "paid", paymentMethod: "cash", items: [line("p1", "Completo", 2, 7000)] }),
        order({
          channel: "delivery",
          status: "out_for_delivery",
          total: 9500,
          deliveryFee: 1500,
          items: [line("p1", "Completo italiano", 2, 8000)],
        }),
        order({ channel: "pickup", status: "picked_up", total: 3000, paymentStatus: "paid", paymentMethod: "card_pos", items: [line("p2", "Papas", 1, 3000)] }),
        order({ status: "rejected", total: 99_000 }),
        order({ status: "cancelled", total: 99_000 }),
      ],
      "2026-10-08",
      "CLP",
    );

    expect(summary.orders).toEqual({ total: 5, completed: 2, inProgress: 1, cancelled: 1, rejected: 1 });
    expect(summary.sales).toEqual({ total: 19_500, deliveryFees: 1500, paid: 10_000, unpaid: 9500, averageTicket: 6500 });
    expect(summary.byChannel).toEqual({
      dine_in: { orders: 1, total: 7000 },
      pickup: { orders: 1, total: 3000 },
      delivery: { orders: 1, total: 9500 },
    });
    expect(summary.byPaymentMethod).toEqual({ cash: 7000, card_pos: 3000, transfer: 0 });
    // Same product id under a new name adds up and shows the latest name.
    expect(summary.topProducts).toEqual([
      { name: "Completo italiano", quantity: 4, total: 15_000 },
      { name: "Papas", quantity: 1, total: 3000 },
    ]);
  });

  it("returns zeros for a day without orders", () => {
    const summary = summarizeDay([], "2026-10-08", "CLP");

    expect(summary.sales.averageTicket).toBe(0);
    expect(summary.topProducts).toEqual([]);
    expect(summary.orders.total).toBe(0);
  });

  it("keeps only the five best sellers", () => {
    const items = ["a", "b", "c", "d", "e", "f"].map((id, i) => line(id, id.toUpperCase(), i + 1, 1000));
    const summary = summarizeDay([order({ total: 6000, items })], "2026-10-08", "CLP");

    expect(summary.topProducts.map((p) => p.name)).toEqual(["F", "E", "D", "C", "B"]);
  });
});
