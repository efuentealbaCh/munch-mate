import { formatMoney } from "@app/utils";
import { formatDateTime, formatTime, paymentNote, renderReceipt } from "./receipt";

describe("receipt", () => {
  it("prints dates and times in the restaurant's timezone", () => {
    // 16:48 UTC = 13:48 in Santiago (UTC-3 in October).
    expect(formatTime("2026-10-07T16:48:00Z", "America/Santiago")).toBe("13:48");
    expect(formatDateTime("2026-10-07T16:48:00Z", "America/Santiago")).toMatch(/07-10-2026,? 13:48/);
  });

  it("renders a PDF for an order with options, notes and long names", async () => {
    const pdf = await renderReceipt({
      restaurant: { name: "Sanguchería La Esquina", phone: "+56 2 2345 6789" },
      number: 41,
      ticketNumber: 3,
      channel: "pickup",
      createdAt: "2026-10-07T16:48:00Z",
      estimatedReadyAt: "2026-10-07T17:03:00Z",
      timezone: "America/Santiago",
      customerName: "Ana Pérez",
      customerPhone: "+56912345678",
      items: Array.from({ length: 25 }, (_, i) => ({
        productId: `p${i}`,
        name: `Churrasco italiano con un nombre bastante largo ${i}`,
        unitPrice: 6990,
        quantity: 2,
        modifiers: [{ groupName: "Pan", optionName: "Frica", priceDelta: 500 }],
        note: "Sin mayo",
        lineTotal: 14980,
      })),
      subtotal: 374500,
      deliveryFee: 0,
      total: 374500,
      currency: "CLP",
      delivery: null,
      expectedPayment: null,
      note: "Retiro en moto",
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // 25 lines do not fit in one A5 page: pdfkit must have flowed onto more pages.
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
  });
});

describe("paymentNote", () => {
  const money = (amount: number) => formatMoney(amount);
  const base = { channel: "delivery" as const, expectedPayment: null };

  it("tells pickup customers they pay at the counter", () => {
    expect(paymentNote({ channel: "pickup", expectedPayment: null } as never, money)).toBe(
      "El pago se realiza en el local al retirar.",
    );
  });

  it("states the cash the customer pays with and the change", () => {
    expect(
      paymentNote({ ...base, expectedPayment: { method: "cash", cashAmount: 10000, change: 2500 } } as never, money),
    ).toBe("Pago contra entrega: Efectivo, paga con $10.000 (vuelto $2.500).");
    expect(paymentNote({ ...base, expectedPayment: { method: "card_pos", cashAmount: null, change: null } } as never, money)).toBe(
      "Pago contra entrega: Tarjeta (POS).",
    );
  });
});
