import { businessDate, deriveAccessToken, generateTableToken, isCalendarDate } from "./order-tokens";

describe("businessDate", () => {
  it("uses the restaurant's timezone, not UTC", () => {
    // 02:30 UTC on Oct 7 is still Oct 6 in Santiago (UTC-3).
    const at = new Date("2026-10-07T02:30:00Z");

    expect(businessDate(at, "America/Santiago")).toBe("2026-10-06");
    expect(businessDate(at, "UTC")).toBe("2026-10-07");
  });
});

describe("deriveAccessToken", () => {
  it("is deterministic per order and differs across orders, restaurants and secrets", () => {
    const token = deriveAccessToken("secret", "r1", "c1");

    expect(deriveAccessToken("secret", "r1", "c1")).toBe(token);
    expect(deriveAccessToken("secret", "r1", "c2")).not.toBe(token);
    expect(deriveAccessToken("secret", "r2", "c1")).not.toBe(token);
    expect(deriveAccessToken("other", "r1", "c1")).not.toBe(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("generateTableToken", () => {
  it("produces 10 unambiguous characters", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateTableToken));

    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[a-hj-km-np-z2-9]{10}$/);
  });
});

describe("isCalendarDate", () => {
  it.each(["2026-10-09", "2024-02-29", "2026-12-31"])("accepts %s", (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each(["2026-02-31", "2025-02-29", "2026-13-01", "2026-00-10", "2026-1-5", "hoy"])("rejects %s", (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});
