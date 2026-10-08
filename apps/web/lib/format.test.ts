import { describe, expect, it } from "vitest";
import { formatClockTime, formatPhone, telHref } from "./format";

describe("formatClockTime", () => {
  it("shows hours and minutes in the browser's time zone, 24 h", () => {
    // Built in local time so the test passes in any time zone.
    expect(formatClockTime(new Date(2026, 9, 8, 13, 45).toISOString())).toBe("13:45");
    expect(formatClockTime(new Date(2026, 9, 8, 9, 5).toISOString())).toBe("09:05");
    expect(formatClockTime(new Date(2026, 9, 8, 0, 0).toISOString())).toBe("00:00");
  });

  it("returns anything that is not a date unchanged", () => {
    expect(formatClockTime("pronto")).toBe("pronto");
  });
});

describe("phones", () => {
  it("builds tel: links with digits and the leading + only", () => {
    expect(telHref("+56 9 1234 5678")).toBe("tel:+56912345678");
    expect(telHref("(2) 2345-6789")).toBe("tel:223456789");
  });

  it("spaces Chilean mobiles stored normalized and leaves the rest as stored", () => {
    expect(formatPhone("+56912345678")).toBe("+56 9 1234 5678");
    expect(formatPhone("+56223456789")).toBe("+56223456789");
    expect(formatPhone("+5491123456789")).toBe("+5491123456789");
  });
});
