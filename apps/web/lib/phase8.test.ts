import type { OrderView, PublicMenu, PublicTableBill, TableSessionView } from "@app/types";
import { describe, expect, it } from "vitest";
import { attentionSince, initialTip, isNewCall, minutesAgoLabel, parseTip, sortSessions, upsertSession } from "./floor";
import { canOpenClose, canRegisterPaymentOf, canServeTables, canWorkOrders, restaurantHomeHref } from "./orders-board";
import {
  DEFAULT_PRINT_SETTINGS,
  kitchenTicket,
  loadPrintSettings,
  preBillTicket,
  savePrintSettings,
  shouldAutoPrint,
} from "./print";
import { promoFormValues, promoFromForm, savingsPercent, withPromos } from "./promo";
import { rangeDays, rangePresets, rangeProblem, shortDate } from "./sales-range";
import { billStage, defaultTipMode, tipFromForm } from "./table-bill";
import { messagingPhoneIssue, pickupCheckoutSchemaFor } from "./validation";

// Tuesday 13-10-2026, 13:00 in Santiago.
const TUESDAY = new Date("2026-10-13T16:00:00Z");

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

describe("withPromos", () => {
  const categories: PublicMenu["categories"] = [
    {
      id: "c1",
      name: "Pizzas",
      description: "",
      products: [
        {
          id: "p1",
          name: "Margarita",
          description: "",
          price: 10000,
          promo: { kind: "percent", value: 20, days: [1], startsOn: null, endsOn: null, label: "" },
          available: true,
          image: null,
          modifierGroups: [],
        },
        { id: "p2", name: "Napolitana", description: "", price: 9000, promo: null, available: true, image: null, modifierGroups: [] },
      ],
    },
  ];

  it("charges the discounted price the day it applies and keeps the regular one to show it crossed out", () => {
    const [margarita, napolitana] = withPromos(categories, "America/Santiago", TUESDAY)[0]!.products;
    expect(margarita).toMatchObject({ price: 8000, regularPrice: 10000, promoLabel: "20 % dcto." });
    expect(napolitana).toEqual(categories[0]!.products[1]);
    expect(savingsPercent(8000, 10000)).toBe(20);
  });

  it("leaves the price alone on other days", () => {
    const wednesday = new Date("2026-10-14T16:00:00Z");
    expect(withPromos(categories, "America/Santiago", wednesday)[0]!.products[0]).toMatchObject({ price: 10000 });
  });
});

describe("promo form", () => {
  it("round-trips a discount and validates it like the api", () => {
    const values = { ...promoFormValues(null), enabled: true, value: "15", days: [3, 1] };
    expect(promoFromForm(values, 10000)).toEqual({
      promo: { kind: "percent", value: 15, days: [1, 3], startsOn: null, endsOn: null, label: "" },
    });
    expect(promoFromForm({ ...values, value: "0" }, 10000)).toHaveProperty("error");
    expect(promoFromForm({ ...values, kind: "price", value: "10.000" }, 10000)).toEqual({
      error: "El precio especial debe ser menor que el precio normal",
    });
    expect(promoFromForm({ ...values, kind: "price", value: "6.990" }, 10000)).toMatchObject({ promo: { value: 6990 } });
    expect(promoFromForm({ ...values, startsOn: "2026-10-31", endsOn: "2026-10-01" }, 10000)).toHaveProperty("error");
    expect(promoFormValues({ kind: "price", value: 6990, days: [], startsOn: null, endsOn: null, label: "x" }).value).toBe("6.990");
  });
});

describe("table bill on the customer's phone", () => {
  const bill: PublicTableBill = {
    tableLabel: "Mesa 4",
    open: true,
    lines: [],
    orderCount: 2,
    ordersInProgress: 0,
    subtotal: 23450,
    currency: "CLP",
    tipPercent: 10,
    suggestedTip: 2345,
    waiterCalledAt: null,
    billRequestedAt: null,
    requestedTip: null,
    closedAt: null,
  };

  it("turns the tip choice into an amount", () => {
    expect(tipFromForm("suggested", "", bill)).toEqual({ choice: { kind: "suggested" }, amount: 2345 });
    expect(tipFromForm("none", "", bill)).toEqual({ choice: { kind: "none" }, amount: 0 });
    expect(tipFromForm("amount", "3.000", bill)).toEqual({ choice: { kind: "amount", amount: 3000 }, amount: 3000 });
    expect(tipFromForm("amount", "tres mil", bill)).toBeNull();
    expect(defaultTipMode(bill)).toBe("suggested");
    expect(defaultTipMode({ tipPercent: 0 })).toBe("none");
  });

  it("knows where the account stands", () => {
    expect(billStage(null)).toBe("empty");
    expect(billStage({ ...bill, orderCount: 0 })).toBe("empty");
    expect(billStage(bill)).toBe("open");
    expect(billStage({ ...bill, billRequestedAt: "2026-10-13T20:00:00Z" })).toBe("requested");
    expect(billStage({ ...bill, open: false, closedAt: "2026-10-13T21:00:00Z" })).toBe("paid");
  });
});

describe("the floor", () => {
  const session = (id: string, over: Partial<TableSessionView> = {}): TableSessionView => ({
    id,
    tableId: `t-${id}`,
    tableLabel: `Mesa ${id}`,
    status: "open",
    openedAt: "2026-10-13T19:00:00.000Z",
    closedAt: null,
    lines: [],
    orderIds: [],
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
    closedByName: null,
    ...over,
  });

  it("puts tables asking for attention first, the oldest call first", () => {
    const sorted = sortSessions([
      session("1", { openedAt: "2026-10-13T18:00:00.000Z" }),
      session("2", { billRequestedAt: "2026-10-13T20:05:00.000Z" }),
      session("3", { waiterCalledAt: "2026-10-13T20:01:00.000Z" }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["3", "2", "1"]);
    expect(attentionSince(session("x", { waiterCalledAt: "b", billRequestedAt: "a" }))).toBe("a");
  });

  it("drops closed accounts and rings only for new calls", () => {
    const open = session("1");
    expect(upsertSession([open], { ...open, status: "closed" })).toEqual([]);
    expect(upsertSession([], open)).toEqual([open]);
    const called = { ...open, waiterCalledAt: "2026-10-13T20:00:00.000Z" };
    expect(isNewCall(open, called)).toBe(true);
    expect(isNewCall(called, { ...called, subtotal: 2 })).toBe(false);
  });

  it("starts the charge with the customer's tip and parses what the waiter types", () => {
    expect(initialTip(session("1", { requestedTip: 1500 }))).toBe(1500);
    expect(initialTip(session("1"))).toBe(1000);
    expect(parseTip("")).toBe(0);
    expect(parseTip("2.500")).toBe(2500);
    expect(parseTip("abc")).toBeNull();
    expect(minutesAgoLabel("2026-10-13T20:00:00Z", Date.parse("2026-10-13T20:04:30Z"))).toBe("hace 4 min");
  });
});

describe("roles (waiters)", () => {
  it("lets waiters work the board and the floor, charging only table orders", () => {
    expect(canWorkOrders(["waiter"])).toBe(true);
    expect(canServeTables(["waiter"])).toBe(true);
    expect(canServeTables(["kitchen"])).toBe(false);
    expect(canOpenClose(["waiter"])).toBe(false);
    expect(canRegisterPaymentOf(["waiter"], { channel: "dine_in" })).toBe(true);
    expect(canRegisterPaymentOf(["waiter"], { channel: "pickup" })).toBe(false);
    expect(canRegisterPaymentOf(["cashier"], { channel: "delivery" })).toBe(true);
    expect(restaurantHomeHref({ id: "r1", myRoles: ["waiter"] })).toBe("/admin/r1/salon");
    expect(restaurantHomeHref({ id: "r1", myRoles: ["waiter", "cashier"] })).toBe("/admin/r1");
  });
});

describe("printing", () => {
  const order = {
    id: "o1",
    ticketNumber: 12,
    channel: "dine_in",
    tableLabel: "Mesa 4",
    customerName: "",
    createdAt: "2026-10-13T23:45:00.000Z",
    estimatedReadyAt: null,
    note: "Sin apuro",
    items: [
      {
        productId: "p1",
        name: "Margarita",
        unitPrice: 8000,
        regularUnitPrice: 10000,
        promoLabel: "",
        quantity: 2,
        note: "Sin albahaca",
        lineTotal: 16000,
        modifiers: [{ groupName: "Tamaño", optionName: "Familiar", priceDelta: 0 }],
      },
    ],
  } as unknown as OrderView;

  it("prints what to cook, without prices", () => {
    const ticket = kitchenTicket(order, "Forno Rosso", "America/Santiago");
    expect(ticket.headline).toBe("#12");
    expect(ticket.meta).toEqual(["En la mesa · 20:45", "Mesa 4"]);
    expect(ticket.lines).toEqual([{ quantity: 2, name: "Margarita", details: ["Tamaño: Familiar", "Nota: Sin albahaca"] }]);
    expect(ticket.totals).toEqual([]);
    expect(ticket.footer).toEqual(["Comentario: Sin apuro"]);
  });

  it("states the suggested tip as voluntary on the pre-bill, with and without it", () => {
    const ticket = preBillTicket(
      {
        tableLabel: "Mesa 4",
        currency: "CLP",
        subtotal: 23450,
        tipPercent: 10,
        suggestedTip: 2345,
        requestedTip: null,
        paymentMethod: null,
        lines: [{ name: "Lomo", options: [], quantity: 1, total: 23450 }],
      } as unknown as TableSessionView,
      "Forno Rosso",
      TUESDAY,
    );
    expect(ticket.totals.map((t) => `${t.label}: ${t.amount}`)).toEqual([
      "Consumo: $23.450",
      "Propina sugerida 10 %: $2.345",
      "Total con propina: $25.795",
      "Total sin propina: $23.450",
    ]);
    expect(ticket.footer).toContain("La propina es voluntaria.");
  });

  it("prints by itself only in the mode chosen on this device", () => {
    expect(shouldAutoPrint("off", "created", { status: "pending" })).toBe(false);
    expect(shouldAutoPrint("new", "created", { status: "pending" })).toBe(true);
    expect(shouldAutoPrint("accepted", "updated", { status: "accepted" }, { status: "pending" })).toBe(true);
    expect(shouldAutoPrint("accepted", "updated", { status: "accepted" }, { status: "accepted" })).toBe(false);
    expect(shouldAutoPrint("accepted", "created", { status: "pending" })).toBe(false);
  });

  it("keeps the settings per device and restaurant, ignoring garbage", () => {
    const storage = memoryStorage();
    expect(loadPrintSettings(storage, "r1")).toEqual(DEFAULT_PRINT_SETTINGS);
    savePrintSettings(storage, "r1", { paper: "58", auto: "new" });
    expect(loadPrintSettings(storage, "r1")).toEqual({ paper: "58", auto: "new" });
    expect(loadPrintSettings(storage, "r2")).toEqual(DEFAULT_PRINT_SETTINGS);
    storage.setItem("mm:print-settings:r3", "{not json");
    expect(loadPrintSettings(storage, "r3")).toEqual(DEFAULT_PRINT_SETTINGS);
  });
});

describe("sales range", () => {
  it("validates ranges like the api", () => {
    expect(rangeProblem({ from: "2026-10-01", to: "2026-10-13" }, "2026-10-13")).toBeNull();
    expect(rangeProblem({ from: "2026-10-13", to: "2026-10-01" }, "2026-10-13")).toMatch(/anterior/);
    expect(rangeProblem({ from: "2024-01-01", to: "2026-10-13" }, "2026-10-13")).toMatch(/366/);
    expect(rangeProblem({ from: "", to: "2026-10-13" }, "2026-10-13")).toBe("Elige las dos fechas");
    expect(rangeDays({ from: "2026-09-30", to: "2026-10-02" })).toBe(3);
    expect(shortDate("2026-10-13")).toBe("13-10-2026");
  });

  it("offers this week (from Monday), the last 7 days, this month and last month", () => {
    expect(rangePresets("2026-10-14").map((p) => `${p.label}: ${p.range.from}..${p.range.to}`)).toEqual([
      "Esta semana: 2026-10-12..2026-10-14",
      "Últimos 7 días: 2026-10-08..2026-10-14",
      "Este mes: 2026-10-01..2026-10-14",
      "Mes pasado: 2026-09-01..2026-09-30",
    ]);
  });
});

describe("notices by WhatsApp/SMS at checkout", () => {
  const values = { customerName: "Rita", customerPhone: "+56 2 2345 6789", customerEmail: "", note: "" };

  it("asks for a mobile only when the customer wants notices", () => {
    expect(pickupCheckoutSchemaFor(false).safeParse(values).success).toBe(true);
    const asked = pickupCheckoutSchemaFor(true).safeParse(values);
    expect(asked.success).toBe(false);
    expect(asked.error?.issues[0]?.path).toEqual(["customerPhone"]);
    expect(pickupCheckoutSchemaFor(true).safeParse({ ...values, customerPhone: "9 8765 4321" }).success).toBe(true);
    expect(messagingPhoneIssue("+56 2 2345 6789")).toMatch(/celular/);
    expect(messagingPhoneIssue("+569 87654321")).toBeNull();
  });
});
