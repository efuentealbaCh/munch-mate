import {
  defaultAgentName,
  newNetworkPrinter,
  normalizeAgentName,
  normalizeServerUrl,
  parseArgs,
  parseHostPort,
  parseYesNo,
  sameName,
} from "./input";
import { cleanLabel } from "./text";

describe("normalizeServerUrl", () => {
  it.each([
    ["https://munchmate.example/", "https://munchmate.example"],
    ["https://munchmate.example///", "https://munchmate.example"],
    ["  munchmate.example  ", "https://munchmate.example"],
    ["HTTPS://MunchMate.Example:8443", "https://munchmate.example:8443"],
    ["http://localhost:3000/", "http://localhost:3000"],
    ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeServerUrl(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    [""],
    ["ftp://munchmate.example"],
    ["http://munchmate.example"], // the token must not travel in clear text
    ["https://munchmate.example/api"], // Socket.IO would read the path as the namespace
    ["https://user:pass@munchmate.example"],
    ["https://munchmate.example/?x=1"],
    ["https://"],
  ])("rejects %p", (input) => {
    expect(normalizeServerUrl(input).ok).toBe(false);
  });
});

describe("agent name", () => {
  it("cleans spaces and invisible characters and cuts to 40 characters", () => {
    expect(normalizeAgentName("  Cocina \u200b  principal ")).toEqual({ ok: true, value: "Cocina principal" });
    expect(normalizeAgentName("x".repeat(60))).toEqual({ ok: true, value: "x".repeat(40) });
    expect(normalizeAgentName(" \u200b ").ok).toBe(false);
  });

  it("defaults to the host name", () => {
    expect(defaultAgentName("DESKTOP-COCINA")).toBe("DESKTOP-COCINA");
    expect(defaultAgentName("")).toBe("Cocina");
  });
});

describe("parseHostPort", () => {
  it.each([
    ["192.168.1.50", { host: "192.168.1.50", port: 9100 }],
    ["192.168.1.50:9101", { host: "192.168.1.50", port: 9101 }],
    [" Impresora-Cocina.local ", { host: "impresora-cocina.local", port: 9100 }],
    ["[fe80::1]:9100", { host: "fe80::1", port: 9100 }],
    ["fe80::1", { host: "fe80::1", port: 9100 }],
  ])("%s", (input, expected) => {
    expect(parseHostPort(input)).toEqual({ ok: true, value: expected });
  });

  it.each([[""], ["192.168.1.50:"], ["192.168.1.50:0"], ["192.168.1.50:70000"], ["192.168.1.50:abc"], ["mi impresora"], [":9100"], ["[nope]:9100"]])(
    "rejects %p",
    (input) => {
      expect(parseHostPort(input).ok).toBe(false);
    },
  );
});

describe("newNetworkPrinter", () => {
  const existing = [{ name: "Cocina caliente", host: "192.168.1.50", port: 9100 }];

  it("adds a printer with a clean name", () => {
    expect(newNetworkPrinter("  Barra ", "192.168.1.51", existing)).toEqual({ ok: true, value: { name: "Barra", host: "192.168.1.51", port: 9100 } });
  });

  it("rejects repeated names (case and accents aside) and repeated addresses", () => {
    expect(newNetworkPrinter("COCINA CALIÉNTE", "192.168.1.52", existing).ok).toBe(false);
    expect(newNetworkPrinter("Otra", "192.168.1.50:9100", existing).ok).toBe(false);
    expect(newNetworkPrinter("Otra", "192.168.1.50:9101", existing).ok).toBe(true);
    expect(newNetworkPrinter("   ", "192.168.1.53", existing).ok).toBe(false);
  });

  it("compares names like the server", () => {
    expect(sameName("Cocína  Caliente", "cocina caliente")).toBe(true);
  });
});

describe("cleanLabel", () => {
  it("mirrors the api's cleanLine", () => {
    expect(cleanLabel("\ufeffEPSON\u00ad  TM-T20\tII\n")).toBe("EPSON TM-T20 II");
    expect(cleanLabel("Cafe\u0301")).toBe("Café");
  });
});

describe("parseYesNo", () => {
  it("reads s/n with a default", () => {
    expect([parseYesNo("", true), parseYesNo("", false), parseYesNo("S", false), parseYesNo("sí", false), parseYesNo("no", true), parseYesNo("tal vez", true)]).toEqual([
      true,
      false,
      true,
      true,
      false,
      null,
    ]);
  });
});

describe("parseArgs", () => {
  it("double click without arguments", () => {
    expect(parseArgs([])).toEqual({ ok: true, value: { kind: "default" } });
  });

  it("pairs without questions", () => {
    expect(parseArgs(["--server", "https://x.example", "--code", "k7mx-3qpa", "--name", "Cocina"])).toEqual({
      ok: true,
      value: { kind: "pair", server: "https://x.example", code: "k7mx-3qpa", name: "Cocina" },
    });
    expect(parseArgs(["--code", "K7MX3QPA", "--server", "x.example"])).toEqual({
      ok: true,
      value: { kind: "pair", server: "x.example", code: "K7MX3QPA", name: null },
    });
    expect(parseArgs(["--server", "https://x.example"]).ok).toBe(false);
    expect(parseArgs(["--server", "--code", "X"]).ok).toBe(false);
    expect(parseArgs(["--server", "a", "--code", "b", "--run"]).ok).toBe(false);
  });

  it("network printers", () => {
    expect(parseArgs(["--add-network", "Cocina", "192.168.1.50:9100"])).toEqual({
      ok: true,
      value: { kind: "add-network", name: "Cocina", address: "192.168.1.50:9100" },
    });
    expect(parseArgs(["--add-network", "Cocina"]).ok).toBe(false);
    expect(parseArgs(["--remove-network", "Cocina"])).toEqual({ ok: true, value: { kind: "remove-network", name: "Cocina" } });
  });

  it("test page with optional paper", () => {
    expect(parseArgs(["--test", "usb:EPSON"])).toEqual({ ok: true, value: { kind: "test", printer: "usb:EPSON", paper: "80" } });
    expect(parseArgs(["--test", "usb:EPSON", "--paper", "58"])).toEqual({ ok: true, value: { kind: "test", printer: "usb:EPSON", paper: "58" } });
    expect(parseArgs(["--test", "usb:EPSON", "--paper", "57"]).ok).toBe(false);
    expect(parseArgs(["--test"]).ok).toBe(false);
  });

  it("simple flags take no arguments and unknown flags fail", () => {
    for (const flag of ["--run", "--list-printers", "--install-startup", "--uninstall-startup", "--unpair", "--version", "--help"]) {
      expect(parseArgs([flag]).ok).toBe(true);
      expect(parseArgs([flag, "extra"]).ok).toBe(false);
    }
    expect(parseArgs(["--imprimir"]).ok).toBe(false);
  });
});
