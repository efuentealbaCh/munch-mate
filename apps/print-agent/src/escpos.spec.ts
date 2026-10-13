import type { PrintLayout, PrintLine } from "@app/types";
import { layoutTicket, testTicket, ticketColumns } from "@app/utils";
import { clampCopies, encodeCp858, layoutToEscPos } from "./escpos";

const line = (text: string, style: Partial<Omit<PrintLine, "text">> = {}): PrintLine => ({
  text,
  align: style.align ?? "left",
  bold: style.bold ?? false,
  size: style.size ?? 1,
});

const bytes = (buffer: Buffer) => [...buffer];
const ascii = (text: string) => [...Buffer.from(text, "ascii")];

const INIT = [0x1b, 0x40, 0x1b, 0x74, 19];
const RESET = [0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0x00];
const FEED = [0x1b, 0x64, 4];
const CUT = [0x1d, 0x56, 66, 0];

describe("encodeCp858", () => {
  it("keeps printable ASCII", () => {
    expect(bytes(encodeCp858("Total $ 12.990 #12"))).toEqual(ascii("Total $ 12.990 #12"));
  });

  it("encodes Spanish letters and signs in CP858", () => {
    expect(bytes(encodeCp858("áéíóú"))).toEqual([0xa0, 0x82, 0xa1, 0xa2, 0xa3]);
    expect(bytes(encodeCp858("ÁÉÍÓÚ"))).toEqual([0xb5, 0x90, 0xd6, 0xe0, 0xe9]);
    expect(bytes(encodeCp858("ñÑüÜ"))).toEqual([0xa4, 0xa5, 0x81, 0x9a]);
    expect(bytes(encodeCp858("¿¡"))).toEqual([0xa8, 0xad]);
    expect(bytes(encodeCp858("°€ºª·"))).toEqual([0xf8, 0xd5, 0xa7, 0xa6, 0xfa]);
  });

  it("composes decomposed accents first (NFC)", () => {
    expect(bytes(encodeCp858("n\u0303a"))).toEqual([0xa4, 0x61]);
  });

  it("prints one ? per character outside the code page (emoji, CJK, typographic symbols)", () => {
    expect(bytes(encodeCp858("a😀b"))).toEqual([0x61, 0x3f, 0x62]);
    expect(bytes(encodeCp858("漢→"))).toEqual([0x3f, 0x3f]);
  });

  it("drops control characters, which would be printer commands", () => {
    expect(bytes(encodeCp858("a\u001b@b\u0007\u0085"))).toEqual(ascii("a@b"));
  });
});

describe("layoutToEscPos", () => {
  it("initializes, selects PC858 and writes one styled row per line", () => {
    const layout: PrintLayout = { columns: 32, lines: [line("Hola")], cut: false };
    expect(bytes(layoutToEscPos(layout, 1))).toEqual([
      ...INIT,
      0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0x00, ...ascii("Hola"), 0x0a,
      ...RESET,
      ...FEED,
    ]);
  });

  it("maps alignment, bold and size", () => {
    const layout: PrintLayout = {
      columns: 48,
      lines: [line("#12", { align: "center", bold: true, size: 2 }), line("$990", { align: "right" })],
      cut: true,
    };
    expect(bytes(layoutToEscPos(layout, 1))).toEqual([
      ...INIT,
      0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x11, ...ascii("#12"), 0x0a,
      0x1b, 0x61, 2, 0x1b, 0x45, 0, 0x1d, 0x21, 0x00, ...ascii("$990"), 0x0a,
      ...RESET,
      ...FEED,
      ...CUT,
    ]);
  });

  it("prints an empty row as a bare line feed", () => {
    const layout: PrintLayout = { columns: 32, lines: [line("")], cut: false };
    expect(bytes(layoutToEscPos(layout, 1))).toEqual([...INIT, 0x1b, 0x61, 0, 0x1b, 0x45, 0, 0x1d, 0x21, 0x00, 0x0a, ...RESET, ...FEED]);
  });

  it("repeats the rows, the style reset, the feed and the cut for every copy", () => {
    const layout: PrintLayout = { columns: 32, lines: [line("Ñ", { bold: true })], cut: true };
    const row = [0x1b, 0x61, 0, 0x1b, 0x45, 1, 0x1d, 0x21, 0x00, 0xa5, 0x0a];
    expect(bytes(layoutToEscPos(layout, 2))).toEqual([...INIT, ...row, ...RESET, ...FEED, ...CUT, ...row, ...RESET, ...FEED, ...CUT]);
  });

  it("clamps copies to 1–3", () => {
    expect([clampCopies(0), clampCopies(1), clampCopies(3), clampCopies(9), clampCopies(1.5), clampCopies(Number.NaN)]).toEqual([1, 1, 3, 3, 1, 1]);
    const layout: PrintLayout = { columns: 32, lines: [], cut: true };
    const cuts = (buffer: Buffer) => buffer.toString("latin1").split("\u001dVB\u0000").length - 1;
    expect(cuts(layoutToEscPos(layout, 9))).toBe(3);
    expect(cuts(layoutToEscPos(layout, 0))).toBe(1);
  });

  it("encodes the shared test page with its accents and without unknown characters", () => {
    const layout = layoutTicket(testTicket("Café Ñuñoa", "EPSON TM-T20", "58", "2026-10-13T15:00:00Z", "America/Santiago"), ticketColumns("58"));
    const output = layoutToEscPos(layout, 1);
    expect(output.includes(Buffer.from([0x43, 0x61, 0x66, 0x82]))).toBe(true); // "Café"
    expect(output.includes(Buffer.from([0xa8, 0x20, 0xad]))).toBe(true); // "¿ ¡"
    expect(output.includes(0x3f)).toBe(false);
  });
});
