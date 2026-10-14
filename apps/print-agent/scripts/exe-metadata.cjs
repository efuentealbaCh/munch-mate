// @ts-check
// Pure helpers for build-exe.mjs: the Windows version resource and manifest of munchmate-impresora.exe.
// CommonJS so Jest (scripts/*.spec.cjs) can test them without ESM support.
"use strict";

const EXE_NAME = "munchmate-impresora.exe";

/**
 * Converts the package version to the 4-part numeric form of Windows version resources.
 * @param {string} version semver from package.json (`0.1.0`, `1.2.3-beta.1`; pre-release/build tags are dropped)
 * @returns {string} `major.minor.patch.0` (e.g. `0.1.0.0`)
 * @throws {Error} when it is not `x.y.z` or a part does not fit in 16 bits
 */
function windowsVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (!match) {
    throw new Error(`Versión inválida para el .exe: "${version}" (se espera x.y.z)`);
  }
  const parts = match.slice(1, 4).map(Number);
  if (parts.some((part) => part > 65535)) {
    throw new Error(`Versión inválida para el .exe: "${version}" (cada parte debe ser ≤ 65535)`);
  }
  return [...parts, 0].join(".");
}

/**
 * The StringFileInfo values shown in Explorer (Properties → Details) and by SmartScreen/UAC.
 * Every value of node.exe is replaced, so nothing says "Node.js" except the license note in Comments.
 * @param {{ version: string, year: number, nodeVersion: string }} input package version, build year, `process.version`
 * @returns {Record<string, string>}
 */
function versionStrings({ version, year, nodeVersion }) {
  const numeric = windowsVersion(version);
  return {
    CompanyName: "Munch Mate",
    ProductName: "Munch Mate Impresora",
    FileDescription: "Agente de impresión de Munch Mate",
    LegalCopyright: `© ${year} Munch Mate`,
    OriginalFilename: EXE_NAME,
    InternalName: "munchmate-impresora",
    FileVersion: numeric,
    ProductVersion: numeric,
    // Node.js is MIT-licensed; the .exe is node.exe plus the agent.
    Comments: `Incluye Node.js ${nodeVersion} (licencia MIT)`,
  };
}

/**
 * Forces `requestedExecutionLevel level="asInvoker"` in an application manifest (no UAC prompt: the agent
 * writes only to %APPDATA% and HKCU). node.exe already declares it; this keeps it explicit and fails loudly
 * if a future Node manifest changes shape, instead of shipping an .exe that asks for admin rights.
 * @param {string} manifest the RT_MANIFEST XML
 * @returns {string} the manifest with `level="asInvoker"` and `uiAccess="false"`
 * @throws {Error} when the manifest has no requestedExecutionLevel element
 */
function asInvokerManifest(manifest) {
  const element = /<requestedExecutionLevel\b[^>]*\/?>/;
  const found = element.exec(manifest);
  if (!found) {
    throw new Error("El manifiesto de node.exe no declara requestedExecutionLevel: revisa build-exe.mjs");
  }
  let tag = found[0];
  tag = /\blevel="[^"]*"/.test(tag) ? tag.replace(/\blevel="[^"]*"/, 'level="asInvoker"') : tag.replace("<requestedExecutionLevel", '<requestedExecutionLevel level="asInvoker"');
  tag = /\buiAccess="[^"]*"/.test(tag) ? tag.replace(/\buiAccess="[^"]*"/, 'uiAccess="false"') : tag.replace(/\s*(\/?)>$/, ' uiAccess="false"$1>');
  return manifest.replace(element, tag);
}

module.exports = { EXE_NAME, windowsVersion, versionStrings, asInvokerManifest };
