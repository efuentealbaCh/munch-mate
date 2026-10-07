import { describe, expect, it } from "vitest";
import { bulkLabels, newLabels, tableUrl } from "./tables";

describe("bulkLabels", () => {
  it("numbers a prefix over a range", () => {
    expect(bulkLabels("Mesa", 1, 3)).toEqual({ ok: true, labels: ["Mesa 1", "Mesa 2", "Mesa 3"] });
    expect(bulkLabels("  Terraza ", 9, 10)).toEqual({ ok: true, labels: ["Terraza 9", "Terraza 10"] });
    expect(bulkLabels("", 4, 5)).toEqual({ ok: true, labels: ["4", "5"] });
  });

  it("rejects reversed, oversized, non-integer and too-long ranges", () => {
    expect(bulkLabels("Mesa", 5, 1).ok).toBe(false);
    expect(bulkLabels("Mesa", 1, 51).ok).toBe(false);
    expect(bulkLabels("Mesa", 1.5, 3).ok).toBe(false);
    expect(bulkLabels("Mesa", -1, 3).ok).toBe(false);
    expect(bulkLabels("x".repeat(29), 1, 10).ok).toBe(false);
    expect(bulkLabels("Mesa", 1, 50).ok).toBe(true);
  });
});

describe("newLabels", () => {
  it("skips labels already in use, ignoring case and extra spaces", () => {
    expect(newLabels(["Mesa 1", "Mesa 2", "Mesa 3"], ["mesa  1", " MESA 3"])).toEqual(["Mesa 2"]);
  });
});

describe("tableUrl", () => {
  it("builds the customer URL printed in the QR", () => {
    expect(tableUrl("https://munchmate.cl/", "abcd234567")).toBe("https://munchmate.cl/m/abcd234567");
  });
});
