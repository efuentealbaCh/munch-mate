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

/** Placeholder and example shown in phone fields: the usual Chilean mobile format. */
export const PHONE_EXAMPLE = "+569 12345678";

/**
 * Formats a phone for display, Chilean style: mobiles as "+569 12345678", other Chilean numbers as
 * "+56 2 23456789", anything else as stored. Accepts normalized or raw input.
 * @returns "" for an empty value; the input unchanged when it is not a plausible phone.
 */
export function formatPhone(phone: string): string {
  if (phone.trim() === "") return "";
  const normalized = normalizePhone(phone);
  if (!normalized) return phone.trim();
  const mobile = normalized.match(/^\+569(\d{8})$/);
  if (mobile) return `+569 ${mobile[1]}`;
  const chilean = normalized.match(/^\+56(\d)(\d{8})$/);
  if (chilean) return `+56 ${chilean[1]} ${chilean[2]}`;
  return normalized;
}

/**
 * Formats what the customer is typing in a phone field, so it reads "+569 12345678" as they go. Digits
 * typed without a prefix are taken as a Chilean mobile; a typed "+" keeps an international number.
 * Never removes digits the user typed (only spaces and separators).
 */
export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return raw.trim().startsWith("+") ? "+" : "";
  if (raw.trim().startsWith("+") && !digits.startsWith("56")) return `+${digits}`;
  const national = digits.startsWith("56") ? digits.slice(2) : digits;
  if (national.startsWith("9")) {
    const rest = national.slice(1);
    return rest ? `+569 ${rest}` : "+569";
  }
  if (national === "") return "+56";
  return national.length > 1 ? `+56 ${national[0]} ${national.slice(1)}` : `+56 ${national}`;
}
