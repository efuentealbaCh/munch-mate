import type { WeeklyHours } from "@app/types";
import { describe, expect, it } from "vitest";
import {
  closedByScheduleText,
  closedStateFromError,
  copyToAllDays,
  copyToWeekdays,
  crossesMidnight,
  dayProblems,
  defaultWeek,
  formatDayRanges,
  isAlwaysClosed,
  liveOpenState,
  nextOpeningLabel,
  sameHours,
  setRangeCount,
  updateRange,
  weekdayIndex,
} from "./opening-hours";

// Dates are built in local time so the tests pass in any time zone (labels use the browser's zone).
const wednesdayNoon = new Date(2026, 9, 7, 12, 0); // miércoles 7 oct 2026
const iso = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min).toISOString();

describe("nextOpeningLabel", () => {
  it("says hoy / mañana / el <día> relative to now, with the local time", () => {
    expect(nextOpeningLabel(iso(2026, 9, 7, 19), wednesdayNoon)).toBe("Abre hoy a las 19:00");
    expect(nextOpeningLabel(iso(2026, 9, 8, 12, 30), wednesdayNoon)).toBe("Abre mañana a las 12:30");
    expect(nextOpeningLabel(iso(2026, 9, 12, 12), wednesdayNoon)).toBe("Abre el lunes a las 12:00");
    expect(nextOpeningLabel(iso(2026, 9, 10, 9), wednesdayNoon)).toBe("Abre el sábado a las 09:00");
  });

  it("adds the day of the month a week ahead (same weekday as today)", () => {
    expect(nextOpeningLabel(iso(2026, 9, 14, 12), wednesdayNoon)).toBe("Abre el miércoles 14 a las 12:00");
  });

  it("uses calendar days, not 24 h blocks (late night → early tomorrow is mañana)", () => {
    expect(nextOpeningLabel(iso(2026, 9, 8, 1), new Date(2026, 9, 7, 23, 30))).toBe("Abre mañana a las 01:00");
  });

  it("returns null without a valid date", () => {
    expect(nextOpeningLabel(null, wednesdayNoon)).toBeNull();
    expect(nextOpeningLabel("pronto", wednesdayNoon)).toBeNull();
  });
});

describe("closed banner", () => {
  it("joins the label, or explains it is the schedule when the next opening is unknown", () => {
    expect(closedByScheduleText({ openNow: false, nextOpeningAt: iso(2026, 9, 7, 19) }, wednesdayNoon)).toBe(
      "Cerrado ahora · Abre hoy a las 19:00",
    );
    expect(closedByScheduleText({ openNow: false, nextOpeningAt: null }, wednesdayNoon)).toBe(
      "Cerrado ahora por horario de atención",
    );
  });

  it("omits the relative part while the browser clock is unknown (server render)", () => {
    expect(closedByScheduleText({ openNow: false, nextOpeningAt: iso(2026, 9, 7, 19) }, null)).toBe("Cerrado ahora");
  });

  it("builds the state from a 409 OUTSIDE_OPENING_HOURS", () => {
    expect(closedStateFromError({ nextOpeningAt: "2026-10-07T22:00:00.000Z" })).toEqual({
      openNow: false,
      nextOpeningAt: "2026-10-07T22:00:00.000Z",
    });
    expect(closedStateFromError(undefined)).toEqual({ openNow: false, nextOpeningAt: null });
  });
});

describe("editor transitions", () => {
  it("starts with every day 12:00–22:00", () => {
    const week = defaultWeek();
    expect(week).toHaveLength(7);
    expect(week.every((day) => day.length === 1 && day[0]!.open === "12:00" && day[0]!.close === "22:00")).toBe(true);
    // Independent objects: editing one day must not change the others.
    expect(updateRange(week, 0, 0, "open", "09:00")[1]![0]!.open).toBe("12:00");
  });

  it("changes the number of ranges keeping what was typed", () => {
    let week = updateRange(defaultWeek(), 2, 0, "close", "15:00");
    week = setRangeCount(week, 2, 2);
    expect(week[2]).toEqual([
      { open: "12:00", close: "15:00" },
      { open: "19:00", close: "23:00" },
    ]);
    expect(setRangeCount(week, 2, 1)[2]).toEqual([{ open: "12:00", close: "15:00" }]);
    expect(setRangeCount(week, 2, 0)[2]).toEqual([]);
    expect(setRangeCount(setRangeCount(week, 3, 0), 3, 1)[3]).toEqual([{ open: "12:00", close: "22:00" }]);
    // Never more than the api allows.
    expect(setRangeCount(week, 2, 5)[2]).toHaveLength(2);
  });

  it("copies one day to every day, or to Monday–Friday only", () => {
    const week = setRangeCount(setRangeCount(defaultWeek(), 0, 2), 6, 0);
    const all = copyToAllDays(week, 0);
    expect(all.every((day) => day.length === 2)).toBe(true);
    const weekdays = copyToWeekdays(week, 0);
    expect(weekdays.slice(0, 5).every((day) => day.length === 2)).toBe(true);
    expect(weekdays[5]).toEqual(week[5]);
    expect(weekdays[6]).toEqual([]);
  });

  it("detects unsaved changes and an all-closed week", () => {
    expect(sameHours(defaultWeek(), defaultWeek())).toBe(true);
    expect(sameHours(defaultWeek(), null)).toBe(false);
    expect(isAlwaysClosed(Array.from({ length: 7 }, () => []))).toBe(true);
    expect(isAlwaysClosed(defaultWeek())).toBe(false);
  });
});

describe("validation", () => {
  it("accepts the default week and ranges past midnight", () => {
    expect(dayProblems(defaultWeek())).toEqual({});
    expect(dayProblems(updateRange(defaultWeek(), 4, 0, "close", "02:00"))).toEqual({});
  });

  it("reports problems per day in Spanish", () => {
    let week: WeeklyHours = updateRange(defaultWeek(), 1, 0, "close", "12:00");
    week = updateRange(week, 3, 0, "open", "");
    week = setRangeCount(week, 5, 2); // 12:00–22:00 + 19:00–23:00 overlap
    expect(dayProblems(week)).toEqual({
      1: "La apertura y el cierre no pueden ser la misma hora.",
      3: "Completa la hora de apertura y de cierre.",
      5: "Los tramos se superponen.",
    });
  });

  it("flags ranges that end the next day", () => {
    expect(crossesMidnight({ open: "19:00", close: "01:00" })).toBe(true);
    expect(crossesMidnight({ open: "12:00", close: "15:00" })).toBe(false);
    expect(crossesMidnight({ open: "19:00", close: "" })).toBe(false);
  });
});

describe("display", () => {
  it("formats a day's ranges", () => {
    expect(formatDayRanges([])).toBe("Cerrado");
    expect(
      formatDayRanges([
        { open: "12:00", close: "15:30" },
        { open: "19:00", close: "23:00" },
      ]),
    ).toBe("12:00–15:30 y 19:00–23:00");
  });

  it("maps weekdays Monday first", () => {
    expect(weekdayIndex(new Date(2026, 9, 5))).toBe(0); // lunes
    expect(weekdayIndex(new Date(2026, 9, 11))).toBe(6); // domingo
  });
});

describe("liveOpenState", () => {
  const fallback = { openNow: false, nextOpeningAt: "x" };
  const dinner: WeeklyHours = Array.from({ length: 7 }, () => [{ open: "19:00", close: "23:00" }]);

  it("uses the api's value while the clock is unknown, and is always open without a schedule", () => {
    expect(liveOpenState(dinner, "America/Santiago", 0, fallback)).toBe(fallback);
    expect(liveOpenState(null, "America/Santiago", Date.UTC(2026, 9, 7, 15), fallback)).toEqual({ openNow: true, nextOpeningAt: null });
  });

  it("recomputes with the restaurant's time zone", () => {
    // 15:00 UTC = 12:00 in Santiago (UTC-3 in October): closed until 19:00 local = 22:00 UTC.
    expect(liveOpenState(dinner, "America/Santiago", Date.UTC(2026, 9, 7, 15), fallback)).toEqual({
      openNow: false,
      nextOpeningAt: "2026-10-07T22:00:00.000Z",
    });
    expect(liveOpenState(dinner, "America/Santiago", Date.UTC(2026, 9, 7, 23), fallback).openNow).toBe(true);
  });
});
