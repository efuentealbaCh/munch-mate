import { describe, expect, it } from "vitest";
import { editPhone, isOnlyPrefix } from "./phone-input";

describe("editPhone", () => {
  it("formats while typing at the end, keeping the caret at the end", () => {
    expect(editPhone("", "9", 1)).toEqual({ value: "+569", caret: 4 });
    expect(editPhone("+569", "+5691", 5)).toEqual({ value: "+569 1", caret: 6 });
    expect(editPhone("", "912345678", 9)).toEqual({ value: "+569 12345678", caret: 13 });
  });

  it("formats pasted numbers written any way", () => {
    expect(editPhone("", "+56 9 1234 5678", 15).value).toBe("+569 12345678");
    expect(editPhone("", "(+56) 9 1234-5678", 17).value).toBe("+569 12345678");
  });

  it("keeps the caret next to the digit typed in the middle", () => {
    expect(editPhone("+569 1234", "+569 18234", 7)).toEqual({ value: "+569 18234", caret: 7 });
  });

  it("deletes normally with backspace at the end, down to an empty field", () => {
    expect(editPhone("+569 1", "+569 ", 5, true)).toEqual({ value: "+569", caret: 4 });
    expect(editPhone("+569", "+56", 3, true)).toEqual({ value: "+56", caret: 3 });
    expect(editPhone("+5", "+", 1, true)).toEqual({ value: "+", caret: 1 });
    expect(editPhone("+", "", 0, true)).toEqual({ value: "", caret: 0 });
  });

  it("backspace over a separator removes the digit before it (otherwise the key would seem dead)", () => {
    // "+569 |1234": the browser removed only the space.
    expect(editPhone("+569 1234", "+5691234", 4, true)).toEqual({ value: "+56 1 234", caret: 3 });
    // Without the backspace flag (e.g. a cut) nothing extra is removed.
    expect(editPhone("+569 1234", "+5691234", 4, false).value).toBe("+569 1234");
  });
});

describe("isOnlyPrefix", () => {
  it("is true while nothing but the prefilled +569 (or part of it) is there", () => {
    for (const value of ["", "+", "+5", "+56", "+569"]) expect(isOnlyPrefix(value), value).toBe(true);
    for (const value of ["+569 1", "+54", "+56 2"]) expect(isOnlyPrefix(value), value).toBe(false);
  });
});
