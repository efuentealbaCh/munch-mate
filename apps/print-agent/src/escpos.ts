import { PRINT_LIMITS, type PrintLayout, type PrintLine } from "@app/types";

/**
 * ESC/POS encoding of a ticket the server already laid out (`PrintLayout`): the agent never wraps or pads,
 * it only turns each row into bytes. Pure functions, no I/O.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** ESC t n: code page. 19 = PC858 (PC850 + euro sign) on Epson and most compatible printers. */
export const CODE_PAGE_PC858 = 19;

/** Lines fed after each copy, so the cut does not fall on the last row. */
export const FEED_LINES = 4;

export const ESCPOS = {
  /** ESC @: initialize (clears modes). */
  init: [ESC, 0x40],
  /** ESC t 19: code page PC858. */
  codePage: [ESC, 0x74, CODE_PAGE_PC858],
  /** ESC a n: 0 left, 1 center, 2 right. */
  align: (align: PrintLine["align"]) => [ESC, 0x61, align === "center" ? 1 : align === "right" ? 2 : 0],
  /** ESC E n: bold on/off. */
  bold: (on: boolean) => [ESC, 0x45, on ? 1 : 0],
  /** GS ! n: 0x11 = double width and height, 0x00 = normal. */
  size: (size: PrintLine["size"]) => [GS, 0x21, size === 2 ? 0x11 : 0x00],
  /** ESC d n: print and feed n lines. */
  feed: (lines: number) => [ESC, 0x64, lines],
  /** GS V 66 0: feed to the cutter and partial cut. */
  cut: [GS, 0x56, 66, 0],
} as const;

/**
 * Unicode → CP858 for everything above ASCII that the code page has (Spanish first: á é í ó ú ñ ü ¿ ¡ ° º ª
 * € ·, plus the rest of Latin-1 that PC850 covers). CP858 is PC850 with € at 0xD5.
 */
const CP858: ReadonlyMap<string, number> = new Map<string, number>([
  ["Ç", 0x80], ["ü", 0x81], ["é", 0x82], ["â", 0x83], ["ä", 0x84], ["à", 0x85], ["å", 0x86], ["ç", 0x87],
  ["ê", 0x88], ["ë", 0x89], ["è", 0x8a], ["ï", 0x8b], ["î", 0x8c], ["ì", 0x8d], ["Ä", 0x8e], ["Å", 0x8f],
  ["É", 0x90], ["æ", 0x91], ["Æ", 0x92], ["ô", 0x93], ["ö", 0x94], ["ò", 0x95], ["û", 0x96], ["ù", 0x97],
  ["ÿ", 0x98], ["Ö", 0x99], ["Ü", 0x9a], ["ø", 0x9b], ["£", 0x9c], ["Ø", 0x9d], ["×", 0x9e], ["ƒ", 0x9f],
  ["á", 0xa0], ["í", 0xa1], ["ó", 0xa2], ["ú", 0xa3], ["ñ", 0xa4], ["Ñ", 0xa5], ["ª", 0xa6], ["º", 0xa7],
  ["¿", 0xa8], ["®", 0xa9], ["¬", 0xaa], ["½", 0xab], ["¼", 0xac], ["¡", 0xad], ["«", 0xae], ["»", 0xaf],
  ["Á", 0xb5], ["Â", 0xb6], ["À", 0xb7], ["©", 0xb8], ["¢", 0xbd], ["¥", 0xbe],
  ["ã", 0xc6], ["Ã", 0xc7], ["¤", 0xcf],
  ["ð", 0xd0], ["Ð", 0xd1], ["Ê", 0xd2], ["Ë", 0xd3], ["È", 0xd4], ["€", 0xd5], ["Í", 0xd6], ["Î", 0xd7],
  ["Ï", 0xd8], ["¦", 0xdd], ["Ì", 0xde],
  ["Ó", 0xe0], ["ß", 0xe1], ["Ô", 0xe2], ["Ò", 0xe3], ["õ", 0xe4], ["Õ", 0xe5], ["µ", 0xe6], ["þ", 0xe7],
  ["Þ", 0xe8], ["Ú", 0xe9], ["Û", 0xea], ["Ù", 0xeb], ["ý", 0xec], ["Ý", 0xed], ["¯", 0xee], ["´", 0xef],
  ["±", 0xf1], ["¾", 0xf3], ["¶", 0xf4], ["§", 0xf5], ["÷", 0xf6], ["¸", 0xf7],
  ["°", 0xf8], ["¨", 0xf9], ["·", 0xfa], ["¹", 0xfb], ["³", 0xfc], ["²", 0xfd], [String.fromCharCode(0xa0), 0xff],
]);

/** Byte printed for characters the code page lacks. */
const UNKNOWN = 0x3f; // "?"

/**
 * Encodes text in CP858: printable ASCII as is, the characters of the table above, and `?` for anything
 * else (one `?` per code point, so an emoji does not shift the columns more than one character). Control
 * characters are dropped: they would be printer commands.
 * @param text Row text (it is normalized to NFC first, so "a" + combining accent becomes "á").
 */
export function encodeCp858(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text.normalize("NFC")) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) bytes.push(code);
    else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) continue;
    else bytes.push(CP858.get(char) ?? UNKNOWN);
  }
  return Buffer.from(bytes);
}

/** Bytes of one row: alignment, bold and size are set explicitly on every row, then the text and a line feed. */
function lineBytes(line: PrintLine): number[] {
  return [
    ...ESCPOS.align(line.align),
    ...ESCPOS.bold(line.bold),
    ...ESCPOS.size(line.size),
    ...(line.text ? encodeCp858(line.text) : []),
    LF,
  ];
}

/** Copies are clamped to the server's limits; anything that is not a whole number prints once. */
export function clampCopies(copies: number): number {
  if (!Number.isInteger(copies)) return PRINT_LIMITS.copiesMin;
  return Math.min(PRINT_LIMITS.copiesMax, Math.max(PRINT_LIMITS.copiesMin, copies));
}

/**
 * Converts a laid-out ticket to ESC/POS.
 *
 * `ESC @` + `ESC t 19` once, then for every copy: each row (`ESC a`, `ESC E`, `GS !`, CP858 text, LF), styles
 * back to normal (left, not bold, normal size) so the next copy starts clean, `ESC d 4` and, when
 * `layout.cut`, a partial cut (`GS V 66 0`).
 * @param layout Rows composed by the server (`layoutTicket` in @app/utils).
 * @param copies How many times to print it (1–3).
 */
export function layoutToEscPos(layout: PrintLayout, copies: number): Buffer {
  const bytes: number[] = [...ESCPOS.init, ...ESCPOS.codePage];
  const body = layout.lines.flatMap(lineBytes);
  for (let copy = 0; copy < clampCopies(copies); copy++) {
    bytes.push(...body);
    bytes.push(...ESCPOS.align("left"), ...ESCPOS.bold(false), ...ESCPOS.size(1));
    bytes.push(...ESCPOS.feed(FEED_LINES));
    if (layout.cut) bytes.push(...ESCPOS.cut);
  }
  return Buffer.from(bytes);
}
