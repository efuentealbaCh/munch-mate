import { createHmac, randomInt } from "node:crypto";

/**
 * The calendar day of `at` in the restaurant's timezone, as YYYY-MM-DD. Daily ticket numbers restart when it
 * changes, so a Santiago restaurant resets at local midnight regardless of the server's timezone.
 */
export function businessDate(at: Date, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * Tracking token of an order, derived (HMAC) from the client order id. Deriving instead of storing it lets
 * a retried submission receive the same token, while the database keeps only its hash.
 */
export function deriveAccessToken(secret: string, restaurantId: string, clientOrderId: string): string {
  return createHmac("sha256", secret).update(`order-access:${restaurantId}:${clientOrderId}`).digest("base64url");
}

/** Unambiguous lowercase alphabet for table codes (no 0/o, 1/l/i), easy to read if typed by hand. */
const TABLE_TOKEN_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** 10 characters ≈ 50 bits: unguessable enough to stop scanning, short enough for a QR and a URL. */
export function generateTableToken(): string {
  return Array.from({ length: 10 }, () => TABLE_TOKEN_ALPHABET[randomInt(TABLE_TOKEN_ALPHABET.length)]).join("");
}

/** Whether "YYYY-MM-DD" is a real calendar day (rejects 2026-02-31, 2026-13-01, 2025-02-29). */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
