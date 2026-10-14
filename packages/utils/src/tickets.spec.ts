import type { OrderView, PrintLayout } from "@app/types";
import {
  formatPairingCode,
  kitchenTicket,
  layoutTicket,
  normalizePairingCode,
  PAIRING_CODE_ALPHABET,
  paymentReceiptTicket,
  printableText,
  RECEIPT_LEGEND,
  testTicket,
  type Ticket,
  ticketColumns,
  wrapText,
} from "./tickets";

const TZ = "America/Santiago";

const order = {
  id: "o1",
  number: 140,
  ticketNumber: 12,
  channel: "dine_in",
  tableLabel: "Mesa 4",
  customerName: "",
  createdAt: "2026-10-13T23:45:00.000Z",
  estimatedReadyAt: null,
  note: "Sin apuro",
  revision: 0,
  edits: [],
  subtotal: 19000,
  deliveryFee: 0,
  total: 19000,
  currency: "CLP",
  items: [
    {
      productId: "pizza",
      name: "Margarita",
      unitPrice: 8000,
      regularUnitPrice: 10000,
      promoLabel: "",
      quantity: 2,
      note: "Sin albahaca",
      lineTotal: 16000,
      modifiers: [{ groupName: "Tamaño", optionName: "Familiar", priceDelta: 0 }],
    },
    {
      productId: "coke",
      name: "Coca-Cola",
      unitPrice: 1500,
      regularUnitPrice: 1500,
      promoLabel: "",
      quantity: 2,
      note: "",
      lineTotal: 3000,
      modifiers: [],
    },
  ],
} as unknown as OrderView;

const categories = new Map([
  ["pizza", "c-food"],
  ["coke", "c-drinks"],
]);

/** Every row fits its paper: normal rows in `columns`, big rows in half of it. */
function expectFits(layout: PrintLayout) {
  for (const row of layout.lines) {
    expect(Array.from(row.text).length).toBeLessThanOrEqual(layout.columns / row.size);
  }
}

describe("kitchenTicket", () => {
  it("prints what to cook, without prices", () => {
    const ticket = kitchenTicket(order, "Forno Rosso", TZ);
    expect(ticket.headline).toBe("#12");
    expect(ticket.meta).toEqual(["En la mesa · 20:45", "Mesa 4"]);
    expect(ticket.lines).toEqual([
      { quantity: 2, name: "Margarita", details: ["Tamaño: Familiar", "Nota: Sin albahaca"] },
      { quantity: 2, name: "Coca-Cola", details: [] },
    ]);
    expect(ticket.totals).toEqual([]);
    expect(ticket.footer).toEqual(["Comentario: Sin apuro"]);
    expect(ticket.banner).toBeUndefined();
  });

  it("keeps only the categories of the printer and says how many units print elsewhere", () => {
    const bar = kitchenTicket(order, "Forno Rosso", TZ, { categoryIds: new Set(["c-drinks"]), productCategory: categories });
    expect(bar.lines.map((l) => l.name)).toEqual(["Coca-Cola"]);
    expect(bar.footer).toEqual(["Comentario: Sin apuro", "2 productos más salen en otra impresora"]);
    // A printer without categories prints everything.
    expect(kitchenTicket(order, "F", TZ, { categoryIds: new Set(), productCategory: categories }).lines).toHaveLength(2);
    // Nothing of the printer's categories: no lines (the caller then creates no job).
    expect(kitchenTicket(order, "F", TZ, { categoryIds: new Set(["c-desserts"]), productCategory: categories }).lines).toEqual([]);
    // A product no longer in the menu prints on every printer rather than nowhere.
    expect(
      kitchenTicket(order, "F", TZ, { categoryIds: new Set(["c-drinks"]), productCategory: new Map([["coke", "c-drinks"]]) }).lines,
    ).toHaveLength(2);
  });

  it("marks an edited order MODIFICADO, with the whole order and the last edit's changes", () => {
    const edited = {
      ...order,
      revision: 2,
      edits: [
        { at: "2026-10-13T23:47:00.000Z", byName: "Ana", reason: null, changes: ["+1 Bebida"] },
        { at: "2026-10-13T23:50:00.000Z", byName: "Ana", reason: "El cliente cambió de idea", changes: ["Margarita (Familiar): 3 → 2"] },
      ],
    } as OrderView;
    const ticket = kitchenTicket(edited, "Forno Rosso", TZ);
    expect(ticket.banner).toBe("MODIFICADO");
    expect(ticket.changes).toEqual({ title: "Cambios 20:50 · Ana:", rows: ["Margarita (Familiar): 3 → 2", "Motivo: El cliente cambió de idea"] });
    const layout = layoutTicket(ticket, 32);
    expect(layout.lines.slice(0, 3)).toEqual([
      { text: "=".repeat(32), align: "left", bold: false, size: 1 },
      { text: "MODIFICADO", align: "center", bold: true, size: 2 },
      { text: "=".repeat(32), align: "left", bold: false, size: 1 },
    ]);
    // The arrow is not in the printer's code page: it prints as "->".
    expect(layout.lines.map((l) => l.text)).toContain("- Margarita (Familiar): 3 -> 2");
  });
});

describe("paymentReceiptTicket", () => {
  const base = { restaurantName: "Forno Rosso", timeZone: TZ, currency: "CLP", at: "2026-10-13T23:50:00.000Z", byName: "Gabi", method: "cash" as const };
  const rows = (ticket: Ticket) => ticket.totals.map((t) => `${t.label}: ${t.amount}`);

  it("prints an equal part with its tip and what is left of the table", () => {
    const ticket = paymentReceiptTicket({
      ...base,
      kind: "table",
      tableLabel: "Mesa 4",
      payment: { kind: "equal", part: 2, parts: 4, amount: 5000, tip: 500, items: [] },
      account: { total: 20000, paid: 10000, remaining: 10000, closed: false },
    });
    expect(ticket.headline).toBe("Mesa 4");
    expect(ticket.meta).toEqual(["Comprobante de pago · 13-10-26, 20:50", "Atendió: Gabi"]);
    expect(rows(ticket)).toEqual([
      "Parte 2 de 4: $5.000",
      "Propina: $500",
      "Total cobrado: $5.500",
      "Medio de pago: Efectivo",
      "Total de la mesa: $20.000",
      "Pagado: $10.000",
      "Falta: $10.000",
    ]);
    expect(ticket.footer.at(-1)).toBe(RECEIPT_LEGEND);
  });

  it("lists the products of a payment by products, and closes the account with the last payment", () => {
    const ticket = paymentReceiptTicket({
      ...base,
      method: "card_pos",
      kind: "table",
      tableLabel: "Mesa 4",
      payment: {
        kind: "items",
        part: null,
        parts: null,
        amount: 9500,
        tip: 0,
        items: [
          { quantity: 1, name: "Margarita", details: ["Tamaño: Familiar"], amount: 8000 },
          { quantity: 1, name: "Coca-Cola", details: [], amount: 1500 },
        ],
      },
      account: { total: 19000, paid: 19000, remaining: 0, closed: true },
    });
    expect(ticket.lines.map((l) => `${l.quantity} ${l.name} ${l.amount}`)).toEqual(["1 Margarita $8.000", "1 Coca-Cola $1.500"]);
    expect(rows(ticket)).toEqual([
      "2 productos: $9.500",
      "Total cobrado: $9.500",
      "Medio de pago: Tarjeta (POS)",
      "Total de la mesa: $19.000",
      "Pagado: $19.000",
      "Cuenta pagada: $0",
    ]);
    expect(ticket.footer).toEqual([RECEIPT_LEGEND]);
  });

  it("prints a free amount as a plain payment", () => {
    const ticket = paymentReceiptTicket({
      ...base,
      method: "transfer",
      kind: "table",
      tableLabel: "Mesa 4",
      payment: { kind: "amount", part: null, parts: null, amount: 7000, tip: 0, items: [] },
      account: { total: 19000, paid: 7000, remaining: 12000, closed: false },
    });
    expect(rows(ticket)[0]).toBe("Pago: $7.000");
    expect(rows(ticket)).toContain("Medio de pago: Transferencia");
  });

  it("prints an order paid on its own with its items, the delivery fee and the method", () => {
    const ticket = paymentReceiptTicket({
      ...base,
      kind: "order",
      byName: null,
      order: { ...order, channel: "delivery", customerName: "Camila", deliveryFee: 2000, total: 21000 },
    });
    expect(ticket.headline).toBe("#12");
    expect(ticket.meta).toEqual(["Comprobante de pago · 13-10-26, 20:50", "Delivery · Pedido N° 140", "Camila"]);
    expect(ticket.lines[0]).toEqual({ quantity: 2, name: "Margarita", details: ["Tamaño: Familiar"], amount: "$16.000" });
    expect(rows(ticket)).toEqual(["Subtotal: $19.000", "Despacho: $2.000", "Total: $21.000", "Medio de pago: Efectivo"]);
    expect(ticket.footer).toEqual([RECEIPT_LEGEND]);
  });
});

describe("layoutTicket", () => {
  it("uses 32 columns on 58 mm paper and 48 on 80 mm", () => {
    expect(ticketColumns("58")).toBe(32);
    expect(ticketColumns("80")).toBe(48);
  });

  it("wraps long names under themselves and keeps amounts aligned on the right edge", () => {
    const ticket: Ticket = {
      headline: "Mesa 12",
      title: "Forno Rosso",
      meta: ["Precuenta"],
      lines: [
        { quantity: 2, name: "Pizza napolitana con doble mozzarella y albahaca fresca", details: ["Tamaño: Familiar (40 cm)"], amount: "$25.980" },
        { quantity: 10, name: "Té", details: [], amount: "$1.500" },
      ],
      totals: [
        { label: "Consumo", amount: "$27.480" },
        { label: "Total con propina sugerida del diez por ciento", amount: "$30.228", strong: true },
      ],
      footer: ["Documento no válido como boleta."],
    };
    for (const columns of [32, 48]) {
      const layout = layoutTicket(ticket, columns);
      expectFits(layout);
      expect(layout.cut).toBe(true);
      const texts = layout.lines.map((l) => l.text);
      // Rows with an amount fill the row exactly, the amount at the end.
      for (const amount of ["$25.980", "$1.500", "$27.480", "$30.228"]) {
        const row = texts.find((t) => t.endsWith(amount));
        expect(row).toBeDefined();
        expect(Array.from(row!).length).toBe(columns);
      }
    }
    const narrow = layoutTicket(ticket, 32).lines.map((l) => l.text);
    expect(narrow).toContain("2 x Pizza napolitana con $25.980");
    expect(narrow).toContain("    doble mozzarella y albahaca");
    expect(narrow).toContain("    fresca");
    expect(narrow).toContain("    Tamaño: Familiar (40 cm)");
    expect(narrow).toContain(`10 x Té${" ".repeat(19)}$1.500`);
    // A long label wraps; the strong total is bold.
    const total = layoutTicket(ticket, 32).lines.find((l) => l.text.endsWith("$30.228"))!;
    expect(total.bold).toBe(true);
  });

  it("keeps accents and ñ as single characters", () => {
    const ticket: Ticket = { headline: "#1", title: "Café Ñuñoa", meta: [], lines: [{ quantity: 1, name: "Piña colada", details: [], amount: "$3.000" }], totals: [], footer: [] };
    const layout = layoutTicket(ticket, 32);
    expect(layout.lines[1]).toEqual({ text: "Café Ñuñoa", align: "center", bold: true, size: 1 });
    const item = layout.lines.find((l) => l.text.startsWith("1 x"))!;
    expect(item.text).toBe("1 x Piña colada" + " ".repeat(32 - 15 - 6) + "$3.000");
    // Decomposed accents (e + combining acute) become one character.
    expect(printableText("Cafe\u0301")).toBe("Café");
  });

  it("prints the headline big and centered, within half the columns", () => {
    const layout = layoutTicket({ headline: "Mesa terraza del fondo 14", title: "X", meta: [], lines: [], totals: [], footer: [] }, 32);
    const big = layout.lines.filter((l) => l.size === 2);
    expect(big.map((l) => l.text)).toEqual(["Mesa terraza del", "fondo 14"]);
    expect(big.every((l) => l.align === "center" && l.bold)).toBe(true);
    expectFits(layout);
  });

  it("lays out kitchen tickets and receipts within both papers", () => {
    const kitchen = kitchenTicket(order, "Forno Rosso", TZ);
    const receipt = paymentReceiptTicket({
      restaurantName: "Forno Rosso",
      timeZone: TZ,
      currency: "CLP",
      at: "2026-10-13T23:50:00.000Z",
      byName: "Gabi",
      method: "cash",
      kind: "order",
      order,
    });
    for (const columns of [32, 48]) {
      expectFits(layoutTicket(kitchen, columns));
      expectFits(layoutTicket(receipt, columns));
    }
    // Kitchen items are bold (what the cook reads).
    expect(layoutTicket(kitchen, 48).lines.find((l) => l.text === "2 x Margarita")?.bold).toBe(true);
  });
});

describe("testTicket", () => {
  it("fits both papers and states the paper it was configured for", () => {
    for (const paper of ["58", "80"] as const) {
      const ticket = testTicket("Forno Rosso", "EPSON TM-T20", paper, "2026-10-13T23:50:00.000Z", TZ);
      expect(ticket.meta[1]).toBe(`Papel ${paper} mm · ${ticketColumns(paper)} columnas`);
      expectFits(layoutTicket(ticket, ticketColumns(paper)));
    }
  });
});

describe("wrapText / printableText", () => {
  it("wraps at spaces and cuts words longer than a row", () => {
    expect(wrapText("uno dos tres", 7)).toEqual(["uno dos", "tres"]);
    expect(wrapText("supercalifragilístico", 8)).toEqual(["supercal", "ifragilí", "stico"]);
    expect(wrapText("   ", 10)).toEqual([]);
  });

  it("drops invisible characters and replaces symbols printers lack", () => {
    expect(printableText("Hola\u200b mundo\u00a0\u2014 \u201cbien\u201d \u2026")).toBe('Hola mundo - "bien" ...');
    expect(printableText("línea\nnueva")).toBe("línea nueva");
  });
});

describe("pairing codes", () => {
  it("normalizes what the user typed and rejects look-alike characters", () => {
    expect(normalizePairingCode("k7mx-3qpa")).toBe("K7MX3QPA");
    expect(normalizePairingCode(" K7MX 3QPA ")).toBe("K7MX3QPA");
    expect(normalizePairingCode("K7MX3QP")).toBeNull();
    expect(normalizePairingCode("K7MX3QP0")).toBeNull();
    expect(PAIRING_CODE_ALPHABET).not.toMatch(/[01OIL]/);
    expect(formatPairingCode("K7MX3QPA")).toBe("K7MX-3QPA");
  });
});
