const { asInvokerManifest, versionStrings, windowsVersion } = require("./exe-metadata.cjs");
const { version } = require("../package.json");

describe("windowsVersion", () => {
  it("adds the fourth part", () => {
    expect(windowsVersion("0.1.0")).toBe("0.1.0.0");
    expect(windowsVersion("12.34.56")).toBe("12.34.56.0");
  });

  it("drops pre-release and build tags", () => {
    expect(windowsVersion("1.2.3-beta.1")).toBe("1.2.3.0");
    expect(windowsVersion("1.2.3+build.7")).toBe("1.2.3.0");
  });

  it("works with the package version", () => {
    expect(windowsVersion(version)).toMatch(/^\d+\.\d+\.\d+\.0$/);
  });

  it("rejects versions Windows cannot store", () => {
    expect(() => windowsVersion("1.2")).toThrow("x.y.z");
    expect(() => windowsVersion("v1.2.3")).toThrow("x.y.z");
    expect(() => windowsVersion("1.70000.0")).toThrow("65535");
  });
});

describe("versionStrings", () => {
  it("brands every field shown by Windows", () => {
    expect(versionStrings({ version: "0.1.0", year: 2026, nodeVersion: "v24.21.0" })).toEqual({
      CompanyName: "Munch Mate",
      ProductName: "Munch Mate Impresora",
      FileDescription: "Agente de impresión de Munch Mate",
      LegalCopyright: "© 2026 Munch Mate",
      OriginalFilename: "munchmate-impresora.exe",
      InternalName: "munchmate-impresora",
      FileVersion: "0.1.0.0",
      ProductVersion: "0.1.0.0",
      Comments: "Incluye Node.js v24.21.0 (licencia MIT)",
    });
  });
});

describe("asInvokerManifest", () => {
  const manifest = (element) =>
    `<assembly><trustInfo><security><requestedPrivileges>${element}</requestedPrivileges></security></trustInfo></assembly>`;

  it("keeps node.exe's asInvoker manifest unchanged", () => {
    const xml = manifest('<requestedExecutionLevel level="asInvoker" uiAccess="false"/>');
    expect(asInvokerManifest(xml)).toBe(xml);
  });

  it("downgrades requireAdministrator and uiAccess", () => {
    const xml = manifest('<requestedExecutionLevel level="requireAdministrator" uiAccess="true"/>');
    expect(asInvokerManifest(xml)).toBe(manifest('<requestedExecutionLevel level="asInvoker" uiAccess="false"/>'));
  });

  it("adds missing attributes", () => {
    expect(asInvokerManifest(manifest("<requestedExecutionLevel/>"))).toBe(
      manifest('<requestedExecutionLevel level="asInvoker" uiAccess="false"/>'),
    );
  });

  it("fails when the manifest has no execution level", () => {
    expect(() => asInvokerManifest("<assembly></assembly>")).toThrow("requestedExecutionLevel");
  });
});
