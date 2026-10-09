import { describe, expect, it } from "vitest";
import { formatPrice, formatPriceDelta, formatPriceInput, parsePriceInput } from "./money";

describe("formatPrice", () => {
  it("formats CLP without decimals and with dots", () => {
    expect(formatPrice(3990, "CLP")).toBe("$3.990");
    expect(formatPrice(0, "CLP")).toBe("$0");
    expect(formatPrice(1_250_000)).toBe("$1.250.000");
  });

  it("treats amounts as minor units for currencies with decimals", () => {
    // 1999 cents = 19,99 USD (es-CL uses a comma for decimals).
    expect(formatPrice(1999, "USD")).toMatch(/19,99/);
  });
});

describe("formatPriceDelta", () => {
  it("prefixes a plus sign and hides zero", () => {
    expect(formatPriceDelta(800)).toBe("+$800");
    expect(formatPriceDelta(0)).toBe("");
  });
});

describe("price inputs", () => {
  it("accepts plain digits, thousands separators and a currency sign", () => {
    expect(parsePriceInput("3990")).toBe(3990);
    expect(parsePriceInput("3.990")).toBe(3990);
    expect(parsePriceInput(" $3.990 ")).toBe(3990);
    expect(parsePriceInput("1.000.000")).toBe(1_000_000);
    expect(parsePriceInput("0")).toBe(0);
  });

  it("rejects empty, decimal and malformed values", () => {
    for (const text of ["", " ", "3,5", "3.99", "39.90", "-100", "abc", "1e3", "3..990", ".990"]) {
      expect(parsePriceInput(text), text).toBeNull();
    }
  });

  it("formats the stored value back for the input", () => {
    expect(formatPriceInput(3990)).toBe("3.990");
    expect(formatPriceInput(800)).toBe("800");
    expect(parsePriceInput(formatPriceInput(1_234_567))).toBe(1_234_567);
  });
});
