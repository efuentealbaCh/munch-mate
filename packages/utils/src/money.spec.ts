import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats CLP without decimals and with dot separators", () => {
    expect(formatMoney(10470, "CLP")).toBe("$10.470");
    expect(formatMoney(0)).toBe("$0");
  });

  it("treats other currencies' amounts as minor units", () => {
    expect(formatMoney(1999, "USD")).toMatch(/19,99/);
  });
});
