/**
 * Free-text clean-up, the same the api applies before validating (apps/api/src/common/validation/clean-text.ts),
 * so the forms measure the same text the api will: limits count real characters and a required field filled
 * with blanks or invisible characters is empty. Keep both files in sync.
 */

// Control characters (except tab/newline, handled below) and zero-width/BOM characters that render as nothing.
const INVISIBLE = new RegExp(
  `[${[
    [0x00, 0x08],
    [0x0b, 0x0c],
    [0x0e, 0x1f],
    [0x7f, 0x7f],
    [0xad, 0xad], // soft hyphen
    [0x200b, 0x200f], // zero-width spaces and joiners, direction marks
    [0x2028, 0x2029], // line/paragraph separators
    [0x2060, 0x2060], // word joiner
    [0xfeff, 0xfeff], // byte order mark
  ]
    // Raw characters, not "\u" escapes: none of these code points is special inside a character class.
    .map(([from, to]) => `${String.fromCharCode(from!)}-${String.fromCharCode(to!)}`)
    .join("")}]`,
  "g",
);

/**
 * Single-line text (names, labels, addresses): one space between words, no line breaks, trimmed.
 * @param value Text as typed.
 * @returns The cleaned text.
 */
export function cleanLine(value: string): string {
  return value.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/**
 * Multi-line text (notes, descriptions, reasons): keeps line breaks, but collapses runs of spaces, trims
 * every line and allows at most one blank line in a row.
 * @param value Text as typed.
 * @returns The cleaned text.
 */
export function cleanText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, "")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
