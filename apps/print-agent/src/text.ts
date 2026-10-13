/**
 * Text clean-up that mirrors the api's `cleanLine` (common/validation/clean-text.ts): the server cleans every
 * printer key and name the agent reports, so the agent must report them already clean, or the `printerKey`
 * of the jobs it receives would not match its own keys.
 */

/** Code point ranges removed, same set as the api. */
const INVISIBLE_RANGES: [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x7f],
  [0xad, 0xad], // soft hyphen
  [0x200b, 0x200f], // zero-width spaces and joiners, direction marks
  [0x2028, 0x2029], // line/paragraph separators
  [0x2060, 0x2060], // word joiner
  [0xfeff, 0xfeff], // byte order mark
];

const hex = (code: number) => `\\u${code.toString(16).padStart(4, "0")}`;
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([from, to]) => `${hex(from)}-${hex(to)}`).join("")}]`, "g");

/**
 * Single-line label: NFC, invisible characters removed, one space between words, trimmed.
 * @param value Raw text (printer name, computer name).
 * @returns The cleaned text ("" when nothing visible is left).
 */
export function cleanLabel(value: string): string {
  return value.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/**
 * Cuts text to at most `max` characters (code points, as the server counts them).
 * @returns The text itself when it already fits.
 */
export function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join("");
}
