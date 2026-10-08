import { normalizePhone } from "./phone";

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
