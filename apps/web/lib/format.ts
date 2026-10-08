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

/** "+56 9 1234 5678" → "tel:+56912345678" (digits and the leading + only). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/**
 * Readable version of a phone stored normalized by the api (`+56912345678` → "+56 9 1234 5678").
 * Only Chilean mobiles get spaces; anything else is shown as stored.
 */
export function formatPhone(phone: string): string {
  const mobile = /^\+569(\d{4})(\d{4})$/.exec(phone);
  return mobile ? `+56 9 ${mobile[1]} ${mobile[2]}` : phone;
}
