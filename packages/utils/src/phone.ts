/**
 * Normalizes a phone number typed by a customer to `+<digits>` (E.164-like), so the same phone written as
 * "9 1234 5678", "+56 9 1234 5678" or "(+56) 912345678" is stored and compared the same way.
 *
 * Chile is the default country: 9 digits starting with 9 (mobile) or 2 (Santiago landline) get +56.
 * Numbers with a leading "+" or "00" are taken as international and kept as they are.
 *
 * @returns The normalized phone, or null when it is not a plausible phone number (8–15 digits).
 */
export function normalizePhone(input: string, defaultCountryCode = "56"): string | null {
  const trimmed = input.trim();
  if (!/^[+0-9 ()./-]+$/.test(trimmed)) return null;

  let digits = trimmed.replace(/\D/g, "");
  const international = trimmed.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!international && digits.length === 9) digits = defaultCountryCode + digits;

  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}
