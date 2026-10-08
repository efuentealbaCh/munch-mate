import { formatDateTime, formatTime, renderReceipt } from "./receipt";

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
      total: 374500,
      currency: "CLP",
      note: "Retiro en moto",
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // 25 lines do not fit in one A5 page: pdfkit must have flowed onto more pages.
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
  });
});
