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
