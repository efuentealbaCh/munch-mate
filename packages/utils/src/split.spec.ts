import { equalPartAmount, equalSplitState, isValidSplitParts } from "./split";

describe("equalPartAmount", () => {
  it("divides what is left among the pending parts, rounding down", () => {
    expect(equalPartAmount(30_000, 3, 0)).toBe(10_000);
    expect(equalPartAmount(10_001, 3, 0)).toBe(3333);
  });

  it("gives the last pending part whatever is left, so the parts add up to the bill", () => {
    let remaining = 10_001;
    const paid: number[] = [];
    for (let part = 0; part < 3; part++) {
      const amount = equalPartAmount(remaining, 3, part);
      paid.push(amount);
      remaining -= amount;
    }
    expect(paid).toEqual([3333, 3334, 3334]);
    expect(remaining).toBe(0);
    expect(equalPartAmount(6668, 3, 2)).toBe(6668);
  });

  it("spreads a new order over the parts still pending", () => {
    // 4 parts of 20.000 = 5.000; after paying one, an order of 3.000 arrives: 18.000 over 3 parts.
    expect(equalPartAmount(20_000 - 5000 + 3000, 4, 1)).toBe(6000);
  });

  it("charges at least 1 while something is left, and 0 when nothing is", () => {
    expect(equalPartAmount(2, 3, 0)).toBe(1);
    expect(equalPartAmount(0, 3, 0)).toBe(0);
    expect(equalPartAmount(-500, 3, 1)).toBe(0);
  });

  it("charges what is left when every part was already paid (more orders came)", () => {
    expect(equalPartAmount(4000, 2, 2)).toBe(4000);
  });
});

describe("equalSplitState", () => {
  it("lists the pending parts and the amount of the next one", () => {
    expect(equalSplitState(15_000, 4, [2])).toEqual({ amount: 5000, pendingParts: [1, 3, 4] });
    expect(equalSplitState(7000, 4, [1, 2, 4])).toEqual({ amount: 7000, pendingParts: [3] });
  });

  it("ignores parts outside the plan (paid under a bigger one) and has nothing pending once all are paid", () => {
    expect(equalSplitState(9000, 3, [5])).toEqual({ amount: 3000, pendingParts: [1, 2, 3] });
    expect(equalSplitState(0, 2, [1, 2])).toEqual({ amount: 0, pendingParts: [] });
  });
});

describe("isValidSplitParts", () => {
  it("accepts whole numbers from 2 to 20", () => {
    expect(isValidSplitParts(2)).toBe(true);
    expect(isValidSplitParts(20)).toBe(true);
    expect(isValidSplitParts(1)).toBe(false);
    expect(isValidSplitParts(21)).toBe(false);
    expect(isValidSplitParts(2.5)).toBe(false);
  });
});
