import type { WeeklyHours } from "@app/types";
import { isOpenAt, localClock, nextOpeningAt, openingHoursProblem } from "./opening-hours";

const TZ = "America/Santiago";
// Santiago is UTC-3 in October 2026. 2026-10-07 is a Wednesday (weekday 2).
const at = (local: string) => new Date(`${local}:00-03:00`);

const lunchAndDinner = [{ open: "12:00", close: "15:30" }, { open: "19:00", close: "23:00" }];
const week: WeeklyHours = [
  lunchAndDinner, // lunes
  lunchAndDinner,
  lunchAndDinner, // miércoles
  lunchAndDinner,
  [{ open: "19:00", close: "02:00" }], // viernes, past midnight
  [],
  [], // domingo cerrado
];

describe("localClock", () => {
  it("reads the weekday and minute in the restaurant's timezone", () => {
    expect(localClock(at("2026-10-07T13:45"), TZ)).toEqual({ weekday: 2, minutes: 13 * 60 + 45 });
    // 01:00 UTC on Thursday is still Wednesday 22:00 in Santiago.
    expect(localClock(new Date("2026-10-08T01:00:00Z"), TZ)).toEqual({ weekday: 2, minutes: 22 * 60 });
  });
});

describe("isOpenAt", () => {
  it.each([
    ["2026-10-07T12:00", true],
    ["2026-10-07T15:29", true],
    ["2026-10-07T15:30", false],
    ["2026-10-07T17:00", false],
    ["2026-10-07T22:59", true],
    ["2026-10-09T23:30", true], // viernes
    ["2026-10-10T01:59", true], // sábado de madrugada, sigue el tramo del viernes
    ["2026-10-10T02:00", false],
    ["2026-10-10T20:00", false], // sábado cerrado
  ])("%s → %s", (local, open) => {
    expect(isOpenAt(week, at(local), TZ)).toBe(open);
  });

  it("is always open without a schedule (manual switch only)", () => {
    expect(isOpenAt(null, at("2026-10-07T04:00"), TZ)).toBe(true);
  });
});

describe("nextOpeningAt", () => {
  it("finds the next range today, tomorrow or after closed days", () => {
    expect(nextOpeningAt(week, at("2026-10-07T16:10"), TZ)).toEqual(at("2026-10-07T19:00"));
    expect(nextOpeningAt(week, at("2026-10-07T23:30"), TZ)).toEqual(at("2026-10-08T12:00"));
    // Sábado y domingo cerrados: abre el lunes.
    expect(nextOpeningAt(week, at("2026-10-10T10:00"), TZ)).toEqual(at("2026-10-12T12:00"));
  });

  it("is null without schedule or open days", () => {
    expect(nextOpeningAt(null, at("2026-10-07T10:00"), TZ)).toBeNull();
    expect(nextOpeningAt([[], [], [], [], [], [], []], at("2026-10-07T10:00"), TZ)).toBeNull();
  });
});

describe("openingHoursProblem", () => {
  it("accepts a valid week", () => {
    expect(openingHoursProblem(week)).toBeNull();
  });

  it.each([
    ["six days", week.slice(0, 6), "days"],
    ["three ranges", [[...lunchAndDinner, { open: "23:30", close: "23:45" }], [], [], [], [], [], []], "ranges_per_day"],
    ["a bad time", [[{ open: "9:00", close: "12:00" }], [], [], [], [], [], []], "time_format"],
    ["24:00", [[{ open: "20:00", close: "24:00" }], [], [], [], [], [], []], "time_format"],
    ["an empty range", [[{ open: "12:00", close: "12:00" }], [], [], [], [], [], []], "empty_range"],
    [
      "overlapping ranges",
      [[{ open: "12:00", close: "16:00" }, { open: "15:00", close: "18:00" }], [], [], [], [], [], []],
      "overlap",
    ],
  ])("rejects %s", (_, hours, problem) => {
    expect(openingHoursProblem(hours)).toBe(problem);
  });
});
