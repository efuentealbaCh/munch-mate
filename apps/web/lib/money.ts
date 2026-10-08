/**
 * Money helpers. Amounts are integers in the currency's minor unit (CLP has none: 3990 = $3.990;
 * USD would be cents). Never use floating point to store or send amounts.
 */

const formatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = formatters.get(currency);
  if (!formatter) {
    // The currency's own number of decimals (CLP 0, USD 2) decides how minor units are shown.
    formatter = new Intl.NumberFormat("es-CL", { style: "currency", currency });
    formatters.set(currency, formatter);
  }
  return formatter;
}

/**
 * Formats an amount for display: `formatPrice(3990, "CLP")` → "$3.990".
 * @param amount Integer in the currency's minor unit.
 * @param currency ISO 4217 code (CLP by default).
 */
export function formatPrice(amount: number, currency = "CLP"): string {
  const formatter = currencyFormatter(currency);
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  return formatter.format(amount / 10 ** digits);
}

/**
 * Extra cost of a modifier option: "+$800". Returns "" for 0 (nothing to add).
 * @param delta Integer in the currency's minor unit (≥ 0).
 */
export function formatPriceDelta(delta: number, currency = "CLP"): string {
  return delta > 0 ? `+${formatPrice(delta, currency)}` : "";
}

const plainNumber = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });

/** Value shown in a price input: 3990 → "3.990" (thousands separator, no currency sign). */
export function formatPriceInput(amount: number): string {
  return plainNumber.format(amount);
}

/**
 * Parses what the owner typed in a price input. Accepts "3990", "3.990", "$3.990" and "1.000.000" (dots
 * as es-CL thousands separators); rejects decimals ("3,5"), misplaced dots ("3.99") and anything else.
 * Only for currencies without decimals (CLP), which is the only one restaurants use today.
 * @returns The integer amount, or null when the text is empty or not a valid price.
 */
export function parsePriceInput(text: string): number | null {
  const cleaned = text.replace(/[\s$]/g, "");
  if (!/^(\d+|\d{1,3}(\.\d{3})+)$/.test(cleaned)) return null;
  const value = Number(cleaned.replaceAll(".", ""));
  return Number.isSafeInteger(value) ? value : null;
}
