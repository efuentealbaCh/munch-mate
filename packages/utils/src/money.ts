const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Formats an amount for display in Spanish (Chile): `formatMoney(3990, "CLP")` → "$3.990".
 * Shared by the workers (receipts, emails); the web keeps its own helpers in `lib/money.ts`.
 * @param amount Integer in the currency's minor unit (CLP has none; USD would be cents).
 * @param currency ISO 4217 code.
 */
export function formatMoney(amount: number, currency = "CLP"): string {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("es-CL", { style: "currency", currency });
    formatters.set(currency, formatter);
  }
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
  return formatter.format(amount / 10 ** digits);
}
