import type { OrderRecord } from "./orders.repository";
import { billTotals, toPublicTableBill, toTableSessionView } from "./table-bill";
import type { TableSessionRecord } from "./table-sessions.repository";

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
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    currency: "CLP",
    customerName: "Ana",
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

const item = (productId: string, name: string, quantity: number, unitPrice: number, optionId?: string) => ({
  productId,
  name,
  unitPrice,
  regularUnitPrice: unitPrice,
  promoLabel: "",
  quantity,
  note: "",
  lineTotal: unitPrice * quantity,
  modifiers: optionId ? [{ groupId: "g", groupName: "Tamaño", optionId, optionName: optionId, priceDelta: 0 }] : [],
});

const session = (overrides: Partial<TableSessionRecord> = {}): TableSessionRecord => ({
  id: "s1",
  restaurantId: "r1",
  tableId: "t1",
  tableLabel: "Mesa 4",
  status: "open",
  openedAt: new Date("2026-10-13T20:00:00Z"),
  waiterCalledAt: null,
  billRequestedAt: null,
  requestedTip: null,
  closedAt: null,
  closedBusinessDate: null,
  tip: null,
  paymentMethod: null,
  closedByName: null,
  ...overrides,
});

describe("billTotals", () => {
  it("adds the same product with the same options into one line across orders", () => {
    const totals = billTotals([
      order({ total: 7000, items: [item("p1", "Completo", 2, 3500, "normal")] }),
      order({ total: 5000, items: [item("p1", "Completo", 1, 3500, "normal"), item("p2", "Bebida", 1, 1500)] }),
      order({ total: 4500, items: [item("p1", "Completo", 1, 4500, "xl")] }),
    ]);
    expect(totals.lines).toEqual([
      { name: "Completo", options: ["Tamaño: normal"], quantity: 3, total: 10500 },
      { name: "Bebida", options: [], quantity: 1, total: 1500 },
      { name: "Completo", options: ["Tamaño: xl"], quantity: 1, total: 4500 },
    ]);
    expect(totals.subtotal).toBe(16500);
    expect(totals.orderCount).toBe(3);
  });

  it("leaves rejected and cancelled orders out, and counts what is still in the kitchen or unpaid", () => {
    const totals = billTotals([
      order({ total: 3000, status: "preparing", items: [item("p1", "A", 1, 3000)] }),
      order({ total: 2000, paymentStatus: "paid", items: [item("p2", "B", 1, 2000)] }),
      order({ total: 9000, status: "rejected", items: [item("p3", "C", 1, 9000)] }),
      order({ total: 9000, status: "cancelled", items: [item("p3", "C", 1, 9000)] }),
    ]);
    expect(totals.subtotal).toBe(5000);
    expect(totals.orderCount).toBe(2);
    expect(totals.ordersInProgress).toBe(1);
    expect(totals.unpaidOrders).toBe(1);
  });
});

describe("table account views", () => {
  const restaurant = { currency: "CLP", tipPercent: 10 };
  const orders = [order({ total: 23450, items: [item("p1", "Lomo", 1, 23450)] })];

  it("suggests the tip on the subtotal for the staff", () => {
    const view = toTableSessionView(session({ requestedTip: 2000 }), orders, restaurant);
    expect(view).toMatchObject({ subtotal: 23450, suggestedTip: 2345, requestedTip: 2000, unpaidOrders: 1, orderIds: [orders[0]!.id] });
  });

  it("shows the phones at the table no names and no ids", () => {
    const bill = toPublicTableBill("Mesa 4", session({ waiterCalledAt: new Date("2026-10-13T21:00:00Z") }), orders, restaurant);
    expect(bill).toMatchObject({ open: true, subtotal: 23450, suggestedTip: 2345, waiterCalledAt: "2026-10-13T21:00:00.000Z" });
    expect(JSON.stringify(bill)).not.toContain("Ana");
    expect(JSON.stringify(bill)).not.toContain('"s1"');
  });

  it("shows a just-paid account as closed, and an empty one when there is no account", () => {
    const closedAt = new Date("2026-10-13T22:00:00Z");
    expect(toPublicTableBill("Mesa 4", session({ status: "closed", closedAt }), orders, restaurant)).toMatchObject({
      open: false,
      closedAt: closedAt.toISOString(),
    });
    expect(toPublicTableBill("Mesa 4", null, [], restaurant)).toMatchObject({ open: false, lines: [], subtotal: 0, closedAt: null });
  });
});
