import type { ProductPromo } from "@app/types";
import { discountedPrice, isPromoActive, localDate, promoLabel, promoPrice, promoProblem, promoSchedule } from "./promo";

const TZ = "America/Santiago";
const promo = (over: Partial<ProductPromo> = {}): ProductPromo => ({
  kind: "percent",
  value: 20,
  days: [],
  startsOn: null,
  endsOn: null,
  label: "",
  ...over,
});
// Tuesday 13-10-2026 at 13:00 in Santiago (UTC-3).
const TUESDAY_NOON = new Date("2026-10-13T16:00:00Z");

describe("localDate", () => {
  it("uses the restaurant's day, not UTC's", () => {
    // 01:30 UTC on the 14th is still the 13th in Santiago.
    expect(localDate(new Date("2026-10-14T01:30:00Z"), TZ)).toBe("2026-10-13");
  });
});

describe("promoProblem", () => {
  it("accepts a valid percent and a special price", () => {
    expect(promoProblem(promo(), 5000)).toBeNull();
    expect(promoProblem(promo({ kind: "price", value: 3990, days: [1, 3], startsOn: "2026-10-01", endsOn: "2026-10-31" }), 5000)).toBeNull();
  });

  it("rejects percentages out of range and special prices not lower than the regular one", () => {
    expect(promoProblem(promo({ value: 0 }), 5000)).toBe("percent_range");
    expect(promoProblem(promo({ value: 95 }), 5000)).toBe("percent_range");
    expect(promoProblem(promo({ value: 12.5 }), 5000)).toBe("percent_range");
    expect(promoProblem(promo({ kind: "price", value: 5000 }), 5000)).toBe("price_not_lower");
    expect(promoProblem(promo({ kind: "price", value: -1 }), 5000)).toBe("price_not_lower");
  });

  it("checks days, dates and their order", () => {
    expect(promoProblem(promo({ days: [7] }), 5000)).toBe("days");
    expect(promoProblem(promo({ days: [1, 1] }), 5000)).toBe("days");
    expect(promoProblem(promo({ startsOn: "2026-02-31x" }), 5000)).toBe("dates");
    expect(promoProblem(promo({ startsOn: "2026-10-31", endsOn: "2026-10-01" }), 5000)).toBe("date_order");
    expect(promoProblem(promo({ label: "x".repeat(41) }), 5000)).toBe("label");
  });
});

describe("isPromoActive", () => {
  it("applies every day without days or dates", () => {
    expect(isPromoActive(promo(), TUESDAY_NOON, TZ)).toBe(true);
    expect(isPromoActive(null, TUESDAY_NOON, TZ)).toBe(false);
  });

  it("applies only on its weekdays (Monday = 0)", () => {
    expect(isPromoActive(promo({ days: [1] }), TUESDAY_NOON, TZ)).toBe(true);
    expect(isPromoActive(promo({ days: [0, 2] }), TUESDAY_NOON, TZ)).toBe(false);
  });

  it("applies between its dates, both included", () => {
    expect(isPromoActive(promo({ startsOn: "2026-10-13", endsOn: "2026-10-13" }), TUESDAY_NOON, TZ)).toBe(true);
    expect(isPromoActive(promo({ startsOn: "2026-10-14" }), TUESDAY_NOON, TZ)).toBe(false);
    expect(isPromoActive(promo({ endsOn: "2026-10-12" }), TUESDAY_NOON, TZ)).toBe(false);
  });
});

describe("promoPrice", () => {
  it("rounds a percent off to the peso and keeps the regular price", () => {
    expect(promoPrice(8990, promo({ value: 15 }), TUESDAY_NOON, TZ)).toEqual({
      price: 7642,
      regularPrice: 8990,
      active: true,
      label: "15 % dcto.",
    });
  });

  it("charges the regular price when the discount does not apply today", () => {
    expect(promoPrice(8990, promo({ days: [4] }), TUESDAY_NOON, TZ)).toEqual({ price: 8990, regularPrice: 8990, active: false, label: "" });
  });

  it("uses the special price and the owner's label", () => {
    expect(promoPrice(8990, promo({ kind: "price", value: 5990, label: "Martes de pizza" }), TUESDAY_NOON, TZ).price).toBe(5990);
    expect(promoLabel(promo({ kind: "price", value: 5990, label: " Martes de pizza " }))).toBe("Martes de pizza");
    expect(promoLabel(promo({ kind: "price", value: 5990 }))).toBe("Precio especial");
  });

  it("never goes below zero", () => {
    expect(discountedPrice(1000, promo({ kind: "price", value: 0 }))).toBe(0);
  });
});

describe("promoSchedule", () => {
  it("describes days and dates in Spanish", () => {
    expect(promoSchedule(promo())).toBe("Todos los días");
    expect(promoSchedule(promo({ days: [1] }))).toBe("mar");
    expect(promoSchedule(promo({ days: [3, 1] }))).toBe("mar y jue");
    expect(promoSchedule(promo({ days: [0, 1, 2, 3, 4] }))).toBe("lun a vie");
    expect(promoSchedule(promo({ days: [5, 6], startsOn: "2026-10-01", endsOn: "2026-10-31" }))).toBe("sáb y dom, del 01-10 al 31-10");
  });
});
