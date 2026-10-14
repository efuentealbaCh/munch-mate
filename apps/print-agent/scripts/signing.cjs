// @ts-check
// Pure helpers for sign-exe.mjs: where the certificate comes from, the signtool arguments and how to log them
// without the password. CommonJS so Jest (scripts/*.spec.cjs) can test them without ESM support.
"use strict";

const DEFAULT_TIMESTAMP_URL = "http://timestamp.digicert.com";
const DESCRIPTION = "Munch Mate Impresora";
const DESCRIPTION_URL = "https://github.com/efuentealbaCh/munch-mate";

/**
 * @typedef {{ kind: "pfx", path: string, password: string | undefined }} PfxSource
 * @typedef {{ kind: "store", sha1: string }} StoreSource
 * @typedef {PfxSource | StoreSource} CertificateSource
 */

/**
 * Picks the certificate from the environment, in this order:
 * 1. `SIGN_PFX_PATH` (+ `SIGN_PFX_PASSWORD`, optional for a PFX without password): a .pfx file.
 * 2. `SIGN_CERT_SHA1`: thumbprint of a certificate in the current user's Windows store ("My"). Covers USB
 *    tokens and cloud services whose KSP/CSP exposes the certificate there (SSL.com eSigner, Certum SimplySign).
 * @param {Record<string, string | undefined>} env usually `process.env`
 * @returns {CertificateSource | null} null = no certificate configured (the .exe stays unsigned)
 * @throws {Error} when a variable is set but invalid
 */
function certificateSource(env) {
  const pfxPath = env.SIGN_PFX_PATH?.trim();
  if (pfxPath) {
    // An empty password is passed as "no /p", which is what signtool expects for a PFX without password.
    return { kind: "pfx", path: pfxPath, password: env.SIGN_PFX_PASSWORD || undefined };
  }
  const rawSha1 = env.SIGN_CERT_SHA1;
  if (rawSha1 && rawSha1.trim()) {
    // Thumbprints copied from certmgr come with spaces and sometimes an invisible left-to-right mark.
    const sha1 = rawSha1.replace(/[\s‎‏]/g, "").toUpperCase();
    if (!/^[0-9A-F]{40}$/.test(sha1)) {
      throw new Error("SIGN_CERT_SHA1 debe ser la huella SHA-1 del certificado (40 caracteres hexadecimales)");
    }
    return { kind: "store", sha1 };
  }
  return null;
}

/**
 * Timestamp authority (RFC 3161) from `SIGN_TIMESTAMP_URL`, or DigiCert's by default. Timestamping keeps the
 * signature valid after the certificate expires.
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 * @throws {Error} when the value is not an http(s) URL
 */
function timestampUrl(env) {
  const value = env.SIGN_TIMESTAMP_URL?.trim() || DEFAULT_TIMESTAMP_URL;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`SIGN_TIMESTAMP_URL no es una URL válida: "${value}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`SIGN_TIMESTAMP_URL debe ser http o https: "${value}"`);
  }
  return value;
}

/**
 * Arguments for `signtool sign`: SHA-256 file digest, RFC 3161 timestamp with SHA-256, description and URL
 * (shown in the UAC/SmartScreen details), then the certificate and the file.
 * @param {{ source: CertificateSource, file: string, timestampUrl: string }} input
 * @returns {string[]}
 */
function signArgs({ source, file, timestampUrl: tsa }) {
  const args = ["sign", "/fd", "sha256", "/tr", tsa, "/td", "sha256", "/d", DESCRIPTION, "/du", DESCRIPTION_URL];
  if (source.kind === "pfx") {
    args.push("/f", source.path);
    if (source.password !== undefined) {
      args.push("/p", source.password);
    }
  } else {
    args.push("/sha1", source.sha1);
  }
  args.push(file);
  return args;
}

/**
 * Arguments for `signtool verify`: default Authenticode policy (`/pa`), verbose.
 * @param {string} file
 * @returns {string[]}
 */
function verifyArgs(file) {
  return ["verify", "/pa", "/v", file];
}

/**
 * Copy of signtool arguments safe to log: the value after `/p` (PFX password) is masked.
 * @param {readonly string[]} args
 * @returns {string[]}
 */
function redactArgs(args) {
  return args.map((arg, index) => (index > 0 && args[index - 1].toLowerCase() === "/p" ? "***" : arg));
}

/**
 * Picks the newest Windows SDK bin folder (`10.0.26100.0` > `10.0.22621.0`), ignoring other entries.
 * @param {readonly string[]} names folder names inside `Windows Kits\10\bin`
 * @returns {string | null}
 */
function newestSdkVersion(names) {
  const versions = names.filter((name) => /^\d+(\.\d+){3}$/.test(name));
  if (versions.length === 0) {
    return null;
  }
  const key = (/** @type {string} */ name) => name.split(".").map(Number);
  return versions.reduce((best, name) => {
    const a = key(name);
    const b = key(best);
    for (let i = 0; i < 4; i++) {
      if (a[i] !== b[i]) {
        return a[i] > b[i] ? name : best;
      }
    }
    return best;
  });
}

/**
 * Windows SDK architecture folder for the running Node (`x64`, `arm64`, `x86`).
 * @param {string} arch `process.arch`
 * @returns {string}
 */
function sdkArch(arch) {
  if (arch === "arm64") {
    return "arm64";
  }
  return arch === "ia32" ? "x86" : "x64";
}

module.exports = {
  DEFAULT_TIMESTAMP_URL,
  DESCRIPTION,
  DESCRIPTION_URL,
  certificateSource,
  timestampUrl,
  signArgs,
  verifyArgs,
  redactArgs,
  newestSdkVersion,
  sdkArch,
};
