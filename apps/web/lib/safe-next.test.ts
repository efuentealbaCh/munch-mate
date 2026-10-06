import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN, safeNextPath, withQuery } from "./safe-next";

describe("safeNextPath", () => {
  it.each([
    ["/admin", "/admin"],
    ["/admin/abc/equipo", "/admin/abc/equipo"],
    ["/invitacion?token=abc_123", "/invitacion?token=abc_123"],
    ["/", "/"],
  ])("accepts relative path %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["admin"],
    ["https://evil.example"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["javascript:alert(1)"],
    ["/\t/evil.example"],
    ["/\n/evil.example"],
  ])("rejects %j", (raw) => {
    expect(safeNextPath(raw)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("uses the given fallback", () => {
    expect(safeNextPath("//x", "/")).toBe("/");
  });
});

describe("withQuery", () => {
  it("skips empty params and encodes values", () => {
    expect(withQuery("/registro", { email: "a+b@x.cl", next: "/invitacion?token=t", other: undefined })).toBe(
      "/registro?email=a%2Bb%40x.cl&next=%2Finvitacion%3Ftoken%3Dt",
    );
    expect(withQuery("/ingresar", { next: null })).toBe("/ingresar");
  });
});
