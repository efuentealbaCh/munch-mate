import { ORDER_CHANNEL_LABELS, PAYMENT_METHOD_LABELS, type ReceiptJob } from "@app/types";
import { formatMoney, formatPhone } from "@app/utils";
import PDFDocument from "pdfkit";

// A5 in PDF points: compact enough for an email attachment, prints well on any home printer.
const PAGE = { width: 419.53, margin: 32 };
const CONTENT = PAGE.width - 2 * PAGE.margin;
const BRAND = "#c2410c";
const INK = "#1c1917";
const MUTED = "#57534e";

/** "07-10-2026, 13:45" in the restaurant's timezone. */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** "13:45" in the restaurant's timezone. */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso),
  );
}

/**
 * Renders the internal receipt of an order: restaurant, order numbers, customer, the price snapshot of every
 * line and the total. It states that it is not a tax document (no SII boleta in the MVP) and that the
 * payment happens at the restaurant.
 */
export async function renderReceipt(receipt: ReceiptJob["receipt"]): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A5",
    margin: PAGE.margin,
    info: { Title: `Comprobante pedido ${receipt.number} — ${receipt.restaurant.name}` },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const money = (amount: number) => formatMoney(amount, receipt.currency);
  const x = PAGE.margin;

  // Header: restaurant and document type.
  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(receipt.restaurant.name, x, PAGE.margin, { width: CONTENT });
  if (receipt.restaurant.phone) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Tel. ${formatPhone(receipt.restaurant.phone)}`);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(10).fillColor(BRAND).text("COMPROBANTE DE PEDIDO");
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("Documento interno. No válido como boleta ni factura.");
  rule(doc);

  // Order numbers: the daily ticket is what the counter calls out.
  const top = doc.y;
  doc.font("Helvetica-Bold").fontSize(30).fillColor(INK).text(`#${receipt.ticketNumber}`, x, top);
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  doc.text(`Pedido N° ${receipt.number}`, x + CONTENT / 2, top + 4, { width: CONTENT / 2, align: "right" });
  doc.text(formatDateTime(receipt.createdAt, receipt.timezone), { width: CONTENT / 2, align: "right" });
  doc.text(ORDER_CHANNEL_LABELS[receipt.channel], { width: CONTENT / 2, align: "right" });
  doc.y = Math.max(doc.y, top + 38);
  doc.x = x;

  if (receipt.estimatedReadyAt) {
    const time = formatTime(receipt.estimatedReadyAt, receipt.timezone);
    doc.moveDown(0.4);
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(BRAND)
      .text(receipt.channel === "delivery" ? `Llega aprox. a las ${time}` : `Listo para retirar aprox. a las ${time}`, x);
  }
  if (receipt.customerName || receipt.customerPhone) {
    doc.moveDown(0.4);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(INK)
      .text(`Cliente: ${[receipt.customerName, formatPhone(receipt.customerPhone)].filter(Boolean).join(" · ")}`, x);
  }
  if (receipt.delivery) {
    const { address, unit, reference, zoneName } = receipt.delivery;
    doc.text(`Entrega: ${[address, unit].filter(Boolean).join(", ")} · ${zoneName}`, x, doc.y, { width: CONTENT });
    if (reference) doc.fillColor(MUTED).text(`Referencia: ${reference}`, x, doc.y, { width: CONTENT });
  }
  rule(doc);

  // Lines: quantity × name, chosen options, line total on the right.
  for (const item of receipt.items) {
    const lineTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK);
    doc.text(`${item.quantity} × ${item.name}`, x, lineTop, { width: CONTENT - 80 });
    const afterName = doc.y;
    doc.text(money(item.lineTotal), x + CONTENT - 80, lineTop, { width: 80, align: "right" });
    doc.y = afterName;
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    for (const modifier of item.modifiers) {
      const extra = modifier.priceDelta ? ` (+${money(modifier.priceDelta)})` : "";
      doc.text(`${modifier.groupName}: ${modifier.optionName}${extra}`, x + 12, doc.y, { width: CONTENT - 92 });
    }
    if (item.note) doc.text(`Nota: ${item.note}`, x + 12, doc.y, { width: CONTENT - 92 });
    doc.moveDown(0.5);
  }

  if (receipt.note) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED).text(`Nota del pedido: ${receipt.note}`, x, doc.y, {
      width: CONTENT,
    });
  }
  rule(doc);

  if (receipt.deliveryFee > 0) {
    const feeTop = doc.y;
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text("Subtotal", x, feeTop);
    doc.text(money(receipt.subtotal), x, feeTop, { width: CONTENT, align: "right" });
    const shippingTop = doc.y + 2;
    doc.text("Despacho", x, shippingTop);
    doc.text(money(receipt.deliveryFee), x, shippingTop, { width: CONTENT, align: "right" });
    doc.moveDown(0.5);
  }

  const totalTop = doc.y;
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text("Total", x, totalTop);
  doc.text(money(receipt.total), x, totalTop, { width: CONTENT, align: "right" });
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(paymentNote(receipt, money), x, doc.y, { width: CONTENT });

  doc.end();
  return done;
}

/** How the customer pays: at the counter, or on delivery with the method (and change) they announced. */
export function paymentNote(receipt: ReceiptJob["receipt"], money: (amount: number) => string): string {
  if (receipt.channel !== "delivery") return "El pago se realiza en el local al retirar.";
  const expected = receipt.expectedPayment;
  if (!expected) return "Pago contra entrega.";
  const method = PAYMENT_METHOD_LABELS[expected.method];
  if (expected.cashAmount === null || expected.change === null) return `Pago contra entrega: ${method}.`;
  return `Pago contra entrega: ${method}, paga con ${money(expected.cashAmount)} (vuelto ${money(expected.change)}).`;
}

/** Thin separator with some air around it. */
function rule(doc: PDFKit.PDFDocument): void {
  doc.moveDown(0.6);
  doc
    .moveTo(PAGE.margin, doc.y)
    .lineTo(PAGE.width - PAGE.margin, doc.y)
    .lineWidth(0.5)
    .strokeColor("#d6d3d1")
    .stroke();
  doc.moveDown(0.6);
}
