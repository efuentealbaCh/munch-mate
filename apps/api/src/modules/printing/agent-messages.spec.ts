import { PRINT_LIMITS } from "@app/types";
import { parseHello, parseResult } from "./agent-messages";

describe("parseHello", () => {
  it("cleans names and keeps the first printer of a repeated key", () => {
    expect(
      parseHello({
        appVersion: " 1.2.0 ",
        printers: [
          { key: "usb:EPSON TM-T20", name: "  EPSON   TM-T20 ", kind: "usb" },
          { key: "net:192.168.1.50:9100", name: "Barra", kind: "network" },
          { key: "usb:EPSON TM-T20", name: "Duplicada", kind: "usb" },
        ],
      }),
    ).toEqual({
      appVersion: "1.2.0",
      printers: [
        { key: "usb:EPSON TM-T20", name: "EPSON TM-T20", kind: "usb" },
        { key: "net:192.168.1.50:9100", name: "Barra", kind: "network" },
      ],
    });
  });

  it("rejects malformed payloads", () => {
    expect(parseHello(null)).toBeNull();
    expect(parseHello({ appVersion: "1", printers: "x" })).toBeNull();
    expect(parseHello({ appVersion: "1", printers: [{ key: "a", name: "b", kind: "bluetooth" }] })).toBeNull();
    expect(parseHello({ appVersion: "1", printers: [{ key: " ", name: "b", kind: "usb" }] })).toBeNull();
    const many = Array.from({ length: PRINT_LIMITS.printersPerAgent + 1 }, (_, i) => ({ key: `usb:${i}`, name: "p", kind: "usb" }));
    expect(parseHello({ appVersion: "1", printers: many })).toBeNull();
  });
});

describe("parseResult", () => {
  it("accepts results and cuts long errors", () => {
    expect(parseResult({ jobId: "a".repeat(24), ok: true })).toEqual({ jobId: "a".repeat(24), ok: true });
    expect(parseResult({ jobId: "a".repeat(24), ok: false })).toEqual({ jobId: "a".repeat(24), ok: false, error: "La impresora no respondió" });
    expect(parseResult({ jobId: "a".repeat(24), ok: false, error: "x".repeat(1000) })?.error).toHaveLength(PRINT_LIMITS.errorMax);
  });

  it("rejects bad job ids", () => {
    expect(parseResult({ jobId: "nope", ok: true })).toBeNull();
    expect(parseResult({ jobId: "a".repeat(24), ok: "yes" })).toBeNull();
  });
});
