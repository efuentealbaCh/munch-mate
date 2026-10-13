import { isValidTipPercent, suggestedTip, tipFromChoice } from "./tip";

describe("suggestedTip", () => {
  it("is the percentage of the subtotal, rounded to the peso", () => {
    expect(suggestedTip(23_450, 10)).toBe(2345);
    expect(suggestedTip(12_345, 10)).toBe(1235);
  });

  it("is 0 without a suggestion or without consumption", () => {
    expect(suggestedTip(10_000, 0)).toBe(0);
    expect(suggestedTip(0, 10)).toBe(0);
  });
});

describe("tipFromChoice", () => {
  it("turns each choice into an amount", () => {
    expect(tipFromChoice({ kind: "suggested" }, 20_000, 10)).toBe(2000);
    expect(tipFromChoice({ kind: "none" }, 20_000, 10)).toBe(0);
    expect(tipFromChoice({ kind: "amount", amount: 3000 }, 20_000, 10)).toBe(3000);
  });

  it("rejects negative, fractional or huge amounts", () => {
    expect(tipFromChoice({ kind: "amount", amount: -1 }, 20_000, 10)).toBeNull();
    expect(tipFromChoice({ kind: "amount", amount: 10.5 }, 20_000, 10)).toBeNull();
    expect(tipFromChoice({ kind: "amount", amount: 2_000_000 }, 20_000, 10)).toBeNull();
  });
});

describe("isValidTipPercent", () => {
  it("accepts whole percentages from 0 to 30", () => {
    expect(isValidTipPercent(0)).toBe(true);
    expect(isValidTipPercent(10)).toBe(true);
    expect(isValidTipPercent(31)).toBe(false);
    expect(isValidTipPercent(7.5)).toBe(false);
  });
});
