import type { QrSheetJob } from "@app/types";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// A4 in PDF points (1/72 in). Two columns × three rows of cards per page: big enough to scan from a seat,
// small enough to cut and fit a table stand.
const PAGE = { width: 595.28, height: 841.89, margin: 36 };
const COLUMNS = 2;
const ROWS = 3;
const GAP = 18;

/**
 * Renders a printable sheet with one card per table: restaurant name, QR, table label and the short URL
 * (so the menu can still be opened if the camera fails to scan).
 */
export async function renderQrSheet(job: Pick<QrSheetJob, "restaurantName" | "tables">): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: PAGE.margin, info: { Title: `Códigos QR — ${job.restaurantName}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const cardWidth = (PAGE.width - 2 * PAGE.margin - GAP * (COLUMNS - 1)) / COLUMNS;
  const cardHeight = (PAGE.height - 2 * PAGE.margin - GAP * (ROWS - 1)) / ROWS;
  const qrSize = Math.min(cardWidth, cardHeight) - 90;

  for (const [index, table] of job.tables.entries()) {
    const slot = index % (COLUMNS * ROWS);
    if (index > 0 && slot === 0) doc.addPage();
    const x = PAGE.margin + (slot % COLUMNS) * (cardWidth + GAP);
    const y = PAGE.margin + Math.floor(slot / COLUMNS) * (cardHeight + GAP);

    // Dashed border = cutting guide.
    doc.save().lineWidth(0.5).dash(4, { space: 4 }).strokeColor("#a8a29e").rect(x, y, cardWidth, cardHeight).stroke().restore();

    doc.font("Helvetica-Bold").fontSize(12).fillColor("#1c1917");
    doc.text(job.restaurantName, x + 12, y + 12, { width: cardWidth - 24, align: "center", ellipsis: true, height: 16 });

    // High error correction: the QR still scans if a corner gets stained or covered by a glass.
    const qr = await QRCode.toBuffer(table.url, { errorCorrectionLevel: "H", margin: 1, width: 600 });
    doc.image(qr, x + (cardWidth - qrSize) / 2, y + 34, { width: qrSize, height: qrSize });

    doc.font("Helvetica-Bold").fontSize(20).fillColor("#c2410c");
    doc.text(table.label, x + 12, y + 40 + qrSize, { width: cardWidth - 24, align: "center", height: 24 });
    doc.font("Helvetica").fontSize(8).fillColor("#57534e");
    doc.text("Escanea para ver el menú y pedir", x + 12, y + 66 + qrSize, { width: cardWidth - 24, align: "center" });
    doc.text(table.url.replace(/^https?:\/\//, ""), x + 12, y + 78 + qrSize, { width: cardWidth - 24, align: "center" });
  }

  doc.end();
  return done;
}
