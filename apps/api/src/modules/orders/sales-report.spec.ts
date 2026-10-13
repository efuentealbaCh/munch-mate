import type { OrderRecord } from "./orders.repository";
import { csvField, daysBetween, orderDiscount, salesCsv, summarizeRange } from "./sales-report";

let seq = 0;
function order(overrides: Partial<OrderRecord>): OrderRecord {
  seq++;
  return {
    id: `o${seq}`,
    restaurantId: "r1",
    number: seq,
    ticketNumber: seq,
    businessDate: "2026-10-12",
    channel: "pickup",
    status: "picked_up",
    statusHistory: [],
    paymentStatus: "paid",
    paymentMethod: "cash",
    items: [],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
    currency: "CLP",
    customerName: "Ana Pérez",
    customerPhone: "+56912345678",
    customerEmail: "",
    note: "",
    tableId: null,
    tableLabel: null,
    tableSessionId: null,
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
    createdAt: new Date("2026-10-12T23:30:00Z"),
    updatedAt: new Date(),
    ...overrides,
  };
}

const pizza = (quantity: number, unitPrice: number, regularUnitPrice = unitPrice) => ({
  productId: "p1",
  name: "Pizza",
  unitPrice,
  regularUnitPrice,
  promoLabel: unitPrice < regularUnitPrice ? "Martes" : "",
  quantity,
  note: "",
  lineTotal: unitPrice * quantity,
  modifiers: [],
});

describe("daysBetween", () => {
  it("lists every day of the range, across months", () => {
    expect(daysBetween("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(daysBetween("2026-10-12", "2026-10-12")).toEqual(["2026-10-12"]);
  });
});

describe("summarizeRange", () => {
  it("sums the range, keeps a row per day (empty days too) and adds the tips apart from sales", () => {
    const report = summarizeRange(
      [
        order({ businessDate: "2026-10-12", total: 10000, items: [pizza(2, 5000, 6000)] }),
        order({ businessDate: "2026-10-14", total: 4000, items: [pizza(1, 4000)] }),
        order({ businessDate: "2026-10-14", total: 9000, status: "cancelled", items: [pizza(1, 9000)] }),
      ],
      "2026-10-12",
      "2026-10-14",
      "CLP",
      new Map([["2026-10-12", 1500]]),
    );
    expect(report.sales.total).toBe(14000);
    expect(report.sales.discounts).toBe(2000);
    expect(report.tips).toBe(1500);
    expect(report.days).toEqual([
      { date: "2026-10-12", orders: 1, total: 10000, tips: 1500 },
      { date: "2026-10-13", orders: 0, total: 0, tips: 0 },
      { date: "2026-10-14", orders: 1, total: 4000, tips: 0 },
    ]);
    expect(report).toMatchObject({ from: "2026-10-12", to: "2026-10-14" });
  });

  it("counts discounts per line", () => {
    expect(orderDiscount({ items: [pizza(3, 5000, 6000), pizza(1, 4000)] })).toBe(3000);
  });
});

describe("CSV", () => {
  it("quotes separators and neutralizes formulas", () => {
    expect(csvField("Pizza; grande")).toBe('"Pizza; grande"');
    expect(csvField('Dijo "hola"')).toBe('"Dijo ""hola"""');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("+569 1234")).toBe("'+569 1234");
    expect(csvField("Línea 1\nLínea 2")).toBe("Línea 1 Línea 2");
    expect(csvField(1500)).toBe("1500");
  });

  const orders = [
    order({ total: 10000, items: [pizza(2, 5000, 6000)] }),
    order({ status: "rejected", total: 7000, items: [pizza(1, 7000)] }),
  ];
  const report = summarizeRange(orders, "2026-10-12", "2026-10-12", "CLP", new Map([["2026-10-12", 800]]));

  it("exports one row per order in the restaurant's local time, rejected ones at 0", () => {
    const csv = salesCsv("orders", orders, report, "America/Santiago");
    expect(csv.startsWith("﻿Fecha;Hora;")).toBe(true);
    const rows = csv.trim().split("\r\n");
    expect(rows).toHaveLength(3);
    // 23:30 UTC = 20:30 in Santiago.
    expect(rows[1]).toBe(
      `12-10-2026;20:30;${orders[0]!.number};${orders[0]!.ticketNumber};Para retirar;Ana Pérez;Retirado;Pagado;Efectivo;2;2000;0;10000`,
    );
    expect(rows[2]!.endsWith(";Rechazado;Pagado;Efectivo;1;0;0;0")).toBe(true);
  });

  it("exports products and days with a total row", () => {
    // No trim(): it would strip the BOM too.
    expect(salesCsv("products", orders, report, "America/Santiago").split("\r\n").filter(Boolean)).toEqual([
      "﻿Producto;Unidades;Descuentos;Total vendido",
      "Pizza;2;2000;10000",
    ]);
    expect(salesCsv("days", orders, report, "America/Santiago").split("\r\n").filter(Boolean)).toEqual([
      "﻿Fecha;Pedidos;Ventas;Propinas",
      "12-10-2026;1;10000;800",
      "Total;1;10000;800",
    ]);
  });
});
