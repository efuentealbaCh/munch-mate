import { describe, expect, it } from "vitest";
import { cleanLine, cleanText } from "./clean-text";

// Built from code points so the invisible characters are explicit in the source.
const ZWSP = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const SOFT_HYPHEN = String.fromCharCode(0xad);
const WORD_JOINER = String.fromCharCode(0x2060);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const NBSP = String.fromCharCode(0xa0);

describe("cleanLine", () => {
  it("collapses spaces, tabs and line breaks into one space and trims", () => {
    expect(cleanLine("  Barros \t  Luco \n con\r\npalta  ")).toBe("Barros Luco con palta");
    expect(cleanLine(`Ana${NBSP}${NBSP}Pérez`)).toBe("Ana Pérez");
  });

  it("removes invisible characters and controls", () => {
    expect(cleanLine(`${BOM}Ca${ZWSP}fé${SOFT_HYPHEN} ${WORD_JOINER}con\u0007 leche${LINE_SEPARATOR}`)).toBe("Café con leche");
  });

  it("leaves only blanks or invisibles as an empty string", () => {
    expect(cleanLine(` ${ZWSP}\t${BOM}\n `)).toBe("");
  });

  it("normalizes to NFC, so a decomposed accent counts as one character", () => {
    const decomposed = `Nun${String.fromCharCode(0x303)}oa`; // "n" + combining tilde
    expect(cleanLine(decomposed)).toBe(`Nu${String.fromCharCode(0xf1)}oa`);
    expect(cleanLine(decomposed)).toHaveLength(5);
  });
});

describe("cleanText", () => {
  it("keeps line breaks but trims every line and collapses spaces", () => {
    expect(cleanText("  sin   cebolla  \n   bien \t cocido ")).toBe("sin cebolla\nbien cocido");
  });

  it("allows at most one blank line in a row and normalizes CRLF", () => {
    expect(cleanText("uno\r\n\r\n\r\n\r\ndos\r\rtres")).toBe("uno\n\ndos\n\ntres");
    expect(cleanText("uno\n   \n \t \ndos")).toBe("uno\n\ndos");
  });

  it("removes invisible characters (a line separator is not a line break here)", () => {
    expect(cleanText(`${ZWSP}hola${LINE_SEPARATOR}mundo${BOM}`)).toBe("holamundo");
  });

  it("returns an empty string for blanks, breaks and invisibles only", () => {
    expect(cleanText(`\n ${ZWSP} \n\n\t${BOM}`)).toBe("");
  });
});
