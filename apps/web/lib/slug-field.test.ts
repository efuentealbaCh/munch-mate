import { describe, expect, it } from "vitest";
import {
  localSlugStatus,
  normalizeSlugInput,
  slugAfterNameChange,
  slugStatusAllowsSubmit,
  statusFromAvailability,
} from "./slug-field";

describe("slugAfterNameChange", () => {
  it("follows the name while the slug was not edited", () => {
    expect(slugAfterNameChange("La Picá de Ñuñoa", false, "old")).toBe("la-pica-de-nunoa");
  });

  it("keeps a manually edited slug", () => {
    expect(slugAfterNameChange("La Picá", true, "mi-local")).toBe("mi-local");
  });
});

describe("normalizeSlugInput", () => {
  it("only lowercases", () => {
    expect(normalizeSlugInput("Mi Local")).toBe("mi local");
  });
});

describe("localSlugStatus", () => {
  it("is idle when empty", () => {
    expect(localSlugStatus("")).toEqual({ kind: "idle" });
  });

  it("reports local problems", () => {
    expect(localSlugStatus("ab")).toEqual({ kind: "invalid", problem: "too_short" });
    expect(localSlugStatus("mi local")).toEqual({ kind: "invalid", problem: "invalid_characters" });
    expect(localSlugStatus("admin")).toEqual({ kind: "invalid", problem: "reserved" });
    expect(localSlugStatus("a".repeat(51))).toEqual({ kind: "invalid", problem: "too_long" });
  });

  it("does not check the restaurant's own slug again", () => {
    expect(localSlugStatus("la-pica", "la-pica")).toEqual({ kind: "unchanged" });
  });

  it("needs the api for valid slugs", () => {
    expect(localSlugStatus("la-pica")).toBeNull();
    expect(localSlugStatus("la-pica-2", "la-pica")).toBeNull();
  });
});

describe("statusFromAvailability", () => {
  it("maps the api answer", () => {
    expect(statusFromAvailability({ slug: "x-y-z", available: true })).toEqual({ kind: "available" });
    expect(statusFromAvailability({ slug: "pica", available: false, reason: "taken", suggestion: "pica-2" })).toEqual({
      kind: "taken",
      suggestion: "pica-2",
    });
    expect(statusFromAvailability({ slug: "api", available: false, reason: "reserved" })).toEqual({
      kind: "invalid",
      problem: "reserved",
    });
  });
});

describe("slugStatusAllowsSubmit", () => {
  it("blocks only invalid and taken", () => {
    expect(slugStatusAllowsSubmit({ kind: "available" })).toBe(true);
    expect(slugStatusAllowsSubmit({ kind: "checking" })).toBe(true);
    expect(slugStatusAllowsSubmit({ kind: "unchanged" })).toBe(true);
    expect(slugStatusAllowsSubmit({ kind: "taken" })).toBe(false);
    expect(slugStatusAllowsSubmit({ kind: "invalid", problem: "too_short" })).toBe(false);
  });
});
