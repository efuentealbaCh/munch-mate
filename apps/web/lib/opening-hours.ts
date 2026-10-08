import { OPENING_HOURS_LIMITS, type OpenState, type TimeRange, type WeeklyHours } from "@app/types";
import { isOpenAt, nextOpeningAt, type OpeningHoursProblem, openingHoursProblem, toMinutes } from "@app/utils";
import { formatClockTime } from "./format";

/**
 * Opening hours helpers for the web: the owner's editor (pure state transitions + validation messages)
 * and the customer-facing "Abre mañana a las 12:00" text. Validation rules come from @app/utils, the same
 * ones the api enforces.
 */

export const DAYS_IN_WEEK = 7;

/** First range offered when a closed day gets one. */
export const DEFAULT_RANGE: TimeRange = { open: "12:00", close: "22:00" };
/** Split shift offered for "2 tramos" (lunch and dinner). */
export const DEFAULT_SPLIT: readonly [TimeRange, TimeRange] = [
  { open: "12:00", close: "15:30" },
  { open: "19:00", close: "23:00" },
];

/** Schedule offered when the owner turns "Usar horario" on for the first time: every day 12:00–22:00. */
export function defaultWeek(): WeeklyHours {
  return Array.from({ length: DAYS_IN_WEEK }, () => [{ ...DEFAULT_RANGE }]);
}

/**
 * Sets how many ranges a day has (0 = cerrado, 1 or 2 tramos), keeping the ranges already typed.
 * @returns A new schedule (the input is not mutated).
 */
export function setRangeCount(hours: WeeklyHours, day: number, count: number): WeeklyHours {
  const safe = Math.max(0, Math.min(OPENING_HOURS_LIMITS.rangesPerDay, count));
  return hours.map((ranges, index) => {
    if (index !== day) return ranges;
    if (safe === 0) return [];
    if (safe === 1) return [{ ...(ranges[0] ?? DEFAULT_RANGE) }];
    // Going from 1 to 2: the typed range stays first and the default dinner is added (validation flags overlaps).
    const first = ranges[0] ?? DEFAULT_SPLIT[0];
    const second = ranges[1] ?? DEFAULT_SPLIT[1];
    return [{ ...first }, { ...second }];
  });
}

/** Replaces one time of one range. @returns A new schedule. */
export function updateRange(hours: WeeklyHours, day: number, rangeIndex: number, field: keyof TimeRange, value: string): WeeklyHours {
  return hours.map((ranges, index) =>
    index === day ? ranges.map((range, i) => (i === rangeIndex ? { ...range, [field]: value } : range)) : ranges,
  );
}

/** Copies one day's ranges to every day of the week. */
export function copyToAllDays(hours: WeeklyHours, day: number): WeeklyHours {
  const source = hours[day] ?? [];
  return hours.map(() => source.map((range) => ({ ...range })));
}

/** Copies one day's ranges to Monday–Friday (indexes 0–4); the weekend keeps its own. */
export function copyToWeekdays(hours: WeeklyHours, day: number): WeeklyHours {
  const source = hours[day] ?? [];
  return hours.map((ranges, index) => (index < 5 ? source.map((range) => ({ ...range })) : ranges));
}

/** A range whose close is not after its open ends the next day (19:00–01:00). */
export function crossesMidnight(range: TimeRange): boolean {
  if (!/^\d{2}:\d{2}$/.test(range.open) || !/^\d{2}:\d{2}$/.test(range.close)) return false;
  return toMinutes(range.close) < toMinutes(range.open);
}

const PROBLEM_MESSAGES: Record<OpeningHoursProblem, string> = {
  days: "El horario debe tener los 7 días.",
  ranges_per_day: `Cada día puede tener como máximo ${OPENING_HOURS_LIMITS.rangesPerDay} tramos.`,
  time_format: "Completa la hora de apertura y de cierre.",
  empty_range: "La apertura y el cierre no pueden ser la misma hora.",
  overlap: "Los tramos se superponen.",
};

/** Spanish message for a validation problem from `openingHoursProblem`. */
export function openingHoursMessage(problem: OpeningHoursProblem): string {
  return PROBLEM_MESSAGES[problem];
}

/**
 * Validates each day on its own (same rules as the api), so the editor can show the message next to the day.
 * @returns Day index → message, only for days with a problem (empty object = valid).
 */
export function dayProblems(hours: WeeklyHours): Record<number, string> {
  const problems: Record<number, string> = {};
  if (hours.length !== DAYS_IN_WEEK) return { 0: openingHoursMessage("days") };
  hours.forEach((ranges, day) => {
    // A week with only this day open checks its ranges with the shared rules.
    const week: WeeklyHours = Array.from({ length: DAYS_IN_WEEK }, (_, i) => (i === 0 ? ranges : []));
    const problem = openingHoursProblem(week, OPENING_HOURS_LIMITS.rangesPerDay);
    if (problem) problems[day] = openingHoursMessage(problem);
  });
  return problems;
}

/** True when no day has any range: with a schedule like that nobody can ever order. */
export function isAlwaysClosed(hours: WeeklyHours): boolean {
  return hours.every((ranges) => ranges.length === 0);
}

/** Structural equality, to know whether the editor has unsaved changes. */
export function sameHours(a: WeeklyHours | null, b: WeeklyHours | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** "12:00–15:30 y 19:00–23:00", or "Cerrado" for a day without ranges. */
export function formatDayRanges(ranges: readonly TimeRange[]): string {
  if (ranges.length === 0) return "Cerrado";
  return ranges.map((range) => `${range.open}–${range.close}`).join(" y ");
}

/** Index in WeeklyHours (0 = lunes) of a date's weekday in the browser's time zone. */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * "Abre hoy a las 19:00" / "Abre mañana a las 12:00" / "Abre el lunes a las 12:00", relative to `now`, in the
 * browser's time zone (customers are at the restaurant). A week or more ahead adds the day of the month.
 * @param nextOpeningAt ISO instant from the api's `openState`.
 * @returns null when the date is missing or invalid.
 */
export function nextOpeningLabel(nextOpeningAt: string | null, now: Date): string | null {
  if (!nextOpeningAt) return null;
  const next = new Date(nextOpeningAt);
  if (Number.isNaN(next.getTime())) return null;
  const time = formatClockTime(nextOpeningAt);
  // Rounded: a DST change makes one calendar day 23 or 25 hours long.
  const days = Math.round((startOfDay(next) - startOfDay(now)) / DAY_MS);
  if (days <= 0) return `Abre hoy a las ${time}`;
  if (days === 1) return `Abre mañana a las ${time}`;
  const weekday = WEEKDAY_NAMES[next.getDay()];
  if (days < 7) return `Abre el ${weekday} a las ${time}`;
  return `Abre el ${weekday} ${next.getDate()} a las ${time}`;
}

/**
 * Text of the customer banner when the schedule keeps the restaurant closed: "Cerrado ahora · Abre hoy a las 19:00".
 * @param now null while the browser's clock is unknown (server render): the relative part needs the
 *   visitor's time zone, so it is added after hydration.
 */
export function closedByScheduleText(openState: OpenState, now: Date | null): string {
  if (!now) return "Cerrado ahora";
  const label = nextOpeningLabel(openState.nextOpeningAt, now);
  return label ? `Cerrado ahora · ${label}` : "Cerrado ahora por horario de atención";
}

/**
 * The open state after a 409 OUTSIDE_OPENING_HOURS (its `meta.nextOpeningAt`), so the page can show the
 * banner without waiting for a refresh.
 */
export function closedStateFromError(meta: Record<string, string> | undefined): OpenState {
  return { openNow: false, nextOpeningAt: meta?.nextOpeningAt ?? null };
}

/**
 * Open state recomputed in the browser for staff screens (they know the restaurant's time zone), so
 * "Fuera de horario" follows the clock without reloading. Same rules as the api.
 * @param now Epoch ms; 0 (unknown, first render) returns `fallback` (the api's value at load time).
 */
export function liveOpenState(hours: WeeklyHours | null, timeZone: string, now: number, fallback: OpenState): OpenState {
  if (now === 0) return fallback;
  if (!hours) return { openNow: true, nextOpeningAt: null };
  const at = new Date(now);
  if (isOpenAt(hours, at, timeZone)) return { openNow: true, nextOpeningAt: null };
  return { openNow: false, nextOpeningAt: nextOpeningAt(hours, at, timeZone)?.toISOString() ?? null };
}
