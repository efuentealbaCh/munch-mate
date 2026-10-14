import type { ProductPromo, PromoKind, PublicMenu, PublicProduct } from "@app/types";
import { PROMO_LIMITS } from "@app/types";
import { promoPrice } from "@app/utils";
import { formatPriceInput, parsePriceInput } from "./money";

/**
 * A menu product with its discount applied (phase 8): `price` is what the cart charges now, and
 * `regularPrice`/`promoLabel` are set only while a discount applies (the menu shows the regular price crossed out).
 */
export type MenuProduct = PublicProduct & { regularPrice?: number; promoLabel?: string };

/**
 * Applies the products' discounts at `at`, with the same rule the api uses (`promoPrice` from @app/utils, in
 * the restaurant's timezone), so the cart total matches what the order will cost.
 */
export function withPromos(
  categories: PublicMenu["categories"],
  timeZone: string,
  at: Date = new Date(),
): PublicMenu["categories"] {
  return categories.map((category) => ({
    ...category,
    products: category.products.map((product): MenuProduct => {
      const priced = promoPrice(product.price, product.promo, at, timeZone);
      return priced.active
        ? { ...product, price: priced.price, regularPrice: priced.regularPrice, promoLabel: priced.label }
        : product;
    }),
  }));
}

/** Percentage saved, rounded down ("-20 %"), for the badge next to a discounted price. */
export function savingsPercent(price: number, regularPrice: number): number {
  return regularPrice > 0 ? Math.floor(((regularPrice - price) * 100) / regularPrice) : 0;
}

// ── Owner's discount form ───────────────────────────────────────────────────

export interface PromoFormValues {
  enabled: boolean;
  kind: PromoKind;
  /** Percent ("20") or special price ("6.990"), as typed. */
  value: string;
  /** Weekdays, 0 = Monday; empty = every day. */
  days: number[];
  startsOn: string;
  endsOn: string;
  label: string;
}

export function promoFormValues(promo: ProductPromo | null): PromoFormValues {
  return {
    enabled: promo !== null,
    kind: promo?.kind ?? "percent",
    value: promo ? (promo.kind === "percent" ? String(promo.value) : formatPriceInput(promo.value)) : "",
    days: promo?.days ?? [],
    startsOn: promo?.startsOn ?? "",
    endsOn: promo?.endsOn ?? "",
    label: promo?.label ?? "",
  };
}

/**
 * The discount the form describes, or why it cannot be saved (Spanish message for the field).
 * The api checks it again against the product's price (INVALID_PROMO).
 */
export function promoFromForm(values: PromoFormValues, regularPrice: number): { promo: ProductPromo } | { error: string } {
  const text = values.value.trim();
  const value = values.kind === "percent" ? (/^\d+$/.test(text) ? Number(text) : null) : parsePriceInput(text);
  if (values.kind === "percent") {
    if (value === null || value < PROMO_LIMITS.percentMin || value > PROMO_LIMITS.percentMax) {
      return { error: `Indica un porcentaje entero entre ${PROMO_LIMITS.percentMin} y ${PROMO_LIMITS.percentMax}` };
    }
  } else if (value === null || value >= regularPrice) {
    return { error: "El precio especial debe ser menor que el precio normal" };
  }
  if (values.startsOn && values.endsOn && values.startsOn > values.endsOn) {
    return { error: "La fecha de término debe ser posterior a la de inicio" };
  }
  return {
    promo: {
      kind: values.kind,
      value,
      days: [...values.days].sort((a, b) => a - b),
      startsOn: values.startsOn || null,
      endsOn: values.endsOn || null,
      label: values.label.trim().slice(0, PROMO_LIMITS.labelMax),
    },
  };
}
