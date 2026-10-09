import { normalizePhone } from "@app/utils";

const dateTime = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" });

/** "6 oct 2026, 15:04" in the browser's time zone. Returns the input unchanged if it is not a date. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date);
}

/** "6 oct 2026" in the browser's time zone. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateOnly.format(date);
}

const clockTime = new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/**
 * "13:45" in the browser's time zone (the customer and the staff are at the restaurant, so its local time).
 * @returns The input unchanged if it is not a date.
 */
export function formatClockTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : clockTime.format(date);
}

/**
 * `tel:` link for a phone, with the number normalized like the api stores it ("+569 12345678" →
 * "tel:+56912345678"). Phones are shown with `formatPhone` from `@app/utils` (one rule for the whole app).
 * Anything normalizePhone does not understand keeps only its digits and a leading +.
 */
export function telHref(phone: string): string {
  return `tel:${normalizePhone(phone) ?? phone.replace(/[^\d+]/g, "")}`;
}
