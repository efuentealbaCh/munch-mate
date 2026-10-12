import { cleanLine, cleanText } from "./clean-text";

const line = (value: unknown) => cleanLine({ value });
const text = (value: unknown) => cleanText({ value });

describe("cleanLine", () => {
  it("collapses whitespace, removes line breaks and trims", () => {
    expect(line("   Mesa      1  ")).toBe("Mesa 1");
    expect(line("Av. Grecia\n\n1234")).toBe("Av. Grecia 1234");
  });

  it("turns blanks and invisible characters into an empty string", () => {
    expect(line("      ")).toBe("");
    expect(line("​​﻿")).toBe("");
    expect(line("Ana​ Pérez")).toBe("Ana Pérez");
  });

  it("leaves non-strings alone (validation reports them)", () => {
    expect(line(42)).toBe(42);
    expect(line(undefined)).toBeUndefined();
  });
});

describe("cleanText", () => {
  it("keeps line breaks but no runs of spaces or blank lines", () => {
    expect(text("  Sin   mayo  \r\n\r\n\r\n\r\n  Bien   cocido ")).toBe("Sin mayo\n\nBien cocido");
  });

  it("measures 200 spaces as nothing", () => {
    expect(text(" ".repeat(200))).toBe("");
    expect(text("\n\n\t \n")).toBe("");
  });
});
