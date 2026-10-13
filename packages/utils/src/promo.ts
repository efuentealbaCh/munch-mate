import { PROMO_KINDS, PROMO_LIMITS, type ProductPromo } from "@app/types";
import { localClock } from "./opening-hours";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar day (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(at: Date, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export type PromoProblem = "kind" | "percent_range" | "price_not_lower" | "days" | "dates" | "date_order" | "label";

/**
 * Validates a discount against the product's regular price (shared by the api DTO checks and the web form).
 * @returns The first problem found, or null when valid.
 */
export function promoProblem(promo: ProductPromo, regularPrice: number): PromoProblem | null {
  if (!PROMO_KINDS.includes(promo.kind)) return "kind";
  if (!Number.isInteger(promo.value)) return promo.kind === "percent" ? "percent_range" : "price_not_lower";
  if (promo.kind === "percent" && (promo.value < PROMO_LIMITS.percentMin || promo.value > PROMO_LIMITS.percentMax)) {
    return "percent_range";
  }
  if (promo.kind === "price" && (promo.value < 0 || promo.value >= regularPrice)) return "price_not_lower";
  if (
    !Array.isArray(promo.days) ||
    promo.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    new Set(promo.days).size !== promo.days.length
  ) {
    return "days";
  }
  for (const date of [promo.startsOn, promo.endsOn]) {
    if (date !== null && (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) return "dates";
  }
  if (promo.startsOn && promo.endsOn && promo.startsOn > promo.endsOn) return "date_order";
  if (typeof promo.label !== "string" || promo.label.length > PROMO_LIMITS.labelMax) return "label";
  return null;
}

/** Whether the discount applies at an instant: inside its dates and on one of its weekdays (restaurant time). */
export function isPromoActive(promo: ProductPromo | null, at: Date, timeZone: string): boolean {
  if (!promo) return false;
  const day = localDate(at, timeZone);
  if (promo.startsOn && day < promo.startsOn) return false;
  if (promo.endsOn && day > promo.endsOn) return false;
  return promo.days.length === 0 || promo.days.includes(localClock(at, timeZone).weekday);
}

/** The discounted base price (percent off rounded to the currency unit, never below 0). */
export function discountedPrice(regularPrice: number, promo: ProductPromo): number {
  if (promo.kind === "price") return Math.max(0, Math.min(promo.value, regularPrice));
  return Math.max(0, Math.round((regularPrice * (100 - promo.value)) / 100));
}

/**
 * The base price charged at an instant, with what the menu shows next to it.
 * @returns `price` = what is charged; `regularPrice` = the price before the discount; `active` = a discount
 *   applies now (then `price < regularPrice`).
 */
export function promoPrice(
  regularPrice: number,
  promo: ProductPromo | null,
  at: Date,
  timeZone: string,
): { price: number; regularPrice: number; active: boolean; label: string } {
  if (!promo || !isPromoActive(promo, at, timeZone)) return { price: regularPrice, regularPrice, active: false, label: "" };
  const price = discountedPrice(regularPrice, promo);
  return { price, regularPrice, active: price < regularPrice, label: promoLabel(promo) };
}

/** What the menu shows for a discount: its own label, or "20 % dcto." / "Precio especial". */
export function promoLabel(promo: ProductPromo): string {
  if (promo.label.trim()) return promo.label.trim();
  return promo.kind === "percent" ? `${promo.value} % dcto.` : "Precio especial";
}

const WEEKDAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** When a discount applies, in words: "Todos los días", "mar y jue", "lun a vie", plus its dates. */
export function promoSchedule(promo: ProductPromo): string {
  const days = [...promo.days].sort((a, b) => a - b);
  let when: string;
  if (days.length === 0 || days.length === 7) when = "Todos los días";
  else if (days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1]! + 1)) {
    when = `${WEEKDAY_SHORT[days[0]!]} a ${WEEKDAY_SHORT[days.at(-1)!]}`;
  } else {
    const names = days.map((d) => WEEKDAY_SHORT[d]!);
    when = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
  }
  const fmt = (date: string) => `${date.slice(8, 10)}-${date.slice(5, 7)}`;
  if (promo.startsOn && promo.endsOn) return `${when}, del ${fmt(promo.startsOn)} al ${fmt(promo.endsOn)}`;
  if (promo.startsOn) return `${when}, desde el ${fmt(promo.startsOn)}`;
  if (promo.endsOn) return `${when}, hasta el ${fmt(promo.endsOn)}`;
  return when;
}
