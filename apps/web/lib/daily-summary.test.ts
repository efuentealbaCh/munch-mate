import type { DailySummary } from "@app/types";
import { describe, expect, it } from "vitest";
import {
  businessDateLabel,
  canViewSales,
  channelRows,
  countedOrders,
  paymentRows,
  percentOf,
  shiftDate,
  todayIn,
} from "./daily-summary";
import { pageCount } from "./platform";

const summary: DailySummary = {
  date: "2026-10-08",
  currency: "CLP",
  orders: { total: 7, completed: 4, inProgress: 1, cancelled: 1, rejected: 1 },
  sales: { total: 30000, deliveryFees: 2000, paid: 24000, unpaid: 6000, averageTicket: 6000 },
  byChannel: {
    dine_in: { orders: 3, total: 9000 },
    pickup: { orders: 0, total: 0 },
    delivery: { orders: 2, total: 21000 },
  },
  byPaymentMethod: { cash: 6000, card_pos: 18000, transfer: 0 },
  topProducts: [{ name: "Margarita", quantity: 5, total: 22500 }],
};

describe("percentOf", () => {
  it("rounds to whole percentages and never divides by zero", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(0, 10)).toBe(0);
    expect(percentOf(12, 10)).toBe(100);
  });
});

describe("breakdowns", () => {
  it("lists channels with orders, biggest first, with their share", () => {
    expect(channelRows(summary)).toEqual([
      { key: "delivery", label: "Delivery", amount: 21000, orders: 2, percent: 70 },
      { key: "dine_in", label: expect.any(String), amount: 9000, orders: 3, percent: 30 },
    ]);
  });

  it("lists paid amounts per method, leaving out unused methods", () => {
    const rows = paymentRows(summary);
    expect(rows.map((row) => [row.key, row.amount, row.percent])).toEqual([
      ["card_pos", 18000, 75],
      ["cash", 6000, 25],
    ]);
  });

  it("counts completed and in-progress orders as sales", () => {
    expect(countedOrders(summary)).toBe(5);
  });
});

describe("business dates", () => {
  it("moves across months, years and DST changes", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-04-05", -1)).toBe("2026-04-04");
    expect(shiftDate("no-es-fecha", 1)).toBe("no-es-fecha");
  });

  it("computes today in the restaurant's zone", () => {
    // 02:00 UTC on the 8th is still the 7th in Santiago (UTC-3).
    expect(todayIn("America/Santiago", new Date(Date.UTC(2026, 9, 8, 2)))).toBe("2026-10-07");
    expect(todayIn("UTC", new Date(Date.UTC(2026, 9, 8, 2)))).toBe("2026-10-08");
  });

  it("labels today, yesterday and older days", () => {
    expect(businessDateLabel("2026-10-08", "2026-10-08")).toBe("Hoy");
    expect(businessDateLabel("2026-10-07", "2026-10-08")).toBe("Ayer");
    expect(businessDateLabel("2026-10-05", "2026-10-08")).toMatch(/lunes.*5.*octubre/);
  });
});

describe("access and paging", () => {
  it("lets owners and cashiers see sales", () => {
    expect(canViewSales(["owner"])).toBe(true);
    expect(canViewSales(["cashier", "kitchen"])).toBe(true);
    expect(canViewSales(["kitchen", "rider"])).toBe(false);
  });

  it("counts platform pages of 25", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
  });
});
