import { formatPhone, formatPhoneInput, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["9 1234 5678", "+56912345678"],
    ["912345678", "+56912345678"],
    ["+56 9 1234 5678", "+56912345678"],
    ["(+56) 9-1234-5678", "+56912345678"],
    ["0056912345678", "+56912345678"],
    ["2 2345 6789", "+56223456789"],
    ["+1 (415) 555-0123", "+14155550123"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "abc", "12345", "+56 9 1234 5678 ext 2", "1234567890123456"])("rejects %p", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("formatPhone", () => {
  it.each([
    ["+56912345678", "+569 12345678"],
    ["9 1234 5678", "+569 12345678"],
    ["+56223456789", "+56 2 23456789"],
    ["+14155550123", "+14155550123"],
    ["", ""],
    ["no es un teléfono", "no es un teléfono"],
  ])("%p → %p", (input, expected) => {
    expect(formatPhone(input)).toBe(expected);
  });
});

describe("formatPhoneInput", () => {
  it.each([
    ["9", "+569"],
    ["912345678", "+569 12345678"],
    ["+56 9 1234 5678", "+569 12345678"],
    ["+569", "+569"],
    ["22345678", "+56 2 2345678"],
    ["+1 415", "+1415"],
    ["+", "+"],
    ["+56", "+56"],
    ["", ""],
  ])("%p → %p", (input, expected) => {
    expect(formatPhoneInput(input)).toBe(expected);
  });
});
