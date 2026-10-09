import type { TimeRange, WeeklyHours } from "@app/types";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MINUTES = 24 * 60;

/** "19:30" → 1170. */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours! * 60 + minutes!;
}

/** A range whose close is not after its open ends the next day (19:00–01:00). */
function span(range: TimeRange): { start: number; end: number } {
  const start = toMinutes(range.open);
  const close = toMinutes(range.close);
  return { start, end: close > start ? close : close + DAY_MINUTES };
}

/**
 * Local weekday (0 = Monday … 6 = Sunday) and minute of the day of an instant in a timezone.
 */
export function localClock(at: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export type OpeningHoursProblem = "days" | "ranges_per_day" | "time_format" | "empty_range" | "overlap";

/**
 * Validates a weekly schedule: 7 days (Monday first), at most `maxRanges` ranges per day, "HH:MM" times,
 * no zero-length range and no overlapping ranges within a day.
 * @returns The first problem found, or null when valid.
 */
export function openingHoursProblem(hours: unknown, maxRanges = 2): OpeningHoursProblem | null {
  if (!Array.isArray(hours) || hours.length !== 7) return "days";
  for (const day of hours) {
    if (!Array.isArray(day) || day.length > maxRanges) return "ranges_per_day";
    for (const range of day as unknown[]) {
      const r = range as Partial<TimeRange> | null;
      if (typeof r?.open !== "string" || typeof r.close !== "string" || !TIME.test(r.open) || !TIME.test(r.close)) {
        return "time_format";
      }
      if (r.open === r.close) return "empty_range";
    }
    const spans = (day as TimeRange[]).map(span).sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) if (spans[i]!.start < spans[i - 1]!.end) return "overlap";
  }
  return null;
}

/**
 * Whether the schedule is open at an instant. No schedule (null) means "always open": the restaurant
 * relies on its manual switch only. A range past midnight keeps the previous day open until its close.
 */
export function isOpenAt(hours: WeeklyHours | null, at: Date, timeZone: string): boolean {
  if (!hours) return true;
  const { weekday, minutes } = localClock(at, timeZone);
  const today = hours[weekday] ?? [];
  const yesterday = hours[(weekday + 6) % 7] ?? [];
  return (
    today.some((range) => {
      const { start, end } = span(range);
      return minutes >= start && minutes < end;
    }) ||
    yesterday.some((range) => {
      const { end } = span(range);
      return end > DAY_MINUTES && minutes < end - DAY_MINUTES;
    })
  );
}

/**
 * Next opening instant after `at` (within a week), or null without schedule or with no open day.
 * Computed by minute offsets from `at`, so it can be an hour off when a DST change happens in between
 * (only shown as "Abre a las…", never enforced).
 */
export function nextOpeningAt(hours: WeeklyHours | null, at: Date, timeZone: string): Date | null {
  if (!hours) return null;
  const { weekday, minutes } = localClock(at, timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const day = hours[(weekday + offset) % 7] ?? [];
    const starts = day.map((range) => toMinutes(range.open)).sort((a, b) => a - b);
    for (const start of starts) {
      const delta = offset * DAY_MINUTES + start - minutes;
      if (delta > 0) return new Date(at.getTime() + delta * 60_000 - (at.getTime() % 60_000));
    }
  }
  return null;
}
