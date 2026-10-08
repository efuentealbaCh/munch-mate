import { describe, expect, it } from "vitest";
import { filenameFromDisposition, receiptRetryDelay } from "./download";

describe("filenameFromDisposition", () => {
  it("reads quoted, unquoted and RFC 5987 names", () => {
    expect(filenameFromDisposition('attachment; filename="comprobante-pedido-12.pdf"', "x.pdf")).toBe("comprobante-pedido-12.pdf");
    expect(filenameFromDisposition("attachment; filename=comprobante-pedido-12.pdf", "x.pdf")).toBe("comprobante-pedido-12.pdf");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''comprobante%20pedido.pdf", "x.pdf")).toBe("comprobante pedido.pdf");
  });

  it("falls back when the header is missing or the name is unsafe", () => {
    expect(filenameFromDisposition(null, "comprobante.pdf")).toBe("comprobante.pdf");
    expect(filenameFromDisposition("attachment", "comprobante.pdf")).toBe("comprobante.pdf");
    expect(filenameFromDisposition('attachment; filename="../../etc/passwd"', "comprobante.pdf")).toBe("comprobante.pdf");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A", "comprobante.pdf")).toBe("comprobante.pdf");
  });
});

describe("receiptRetryDelay", () => {
  it("backs off and stays capped", () => {
    expect(receiptRetryDelay(0)).toBe(1_500);
    expect(receiptRetryDelay(1)).toBe(3_000);
    expect(receiptRetryDelay(3)).toBe(8_000);
    expect(receiptRetryDelay(50)).toBe(8_000);
    expect(receiptRetryDelay(-1)).toBe(1_500);
  });
});
