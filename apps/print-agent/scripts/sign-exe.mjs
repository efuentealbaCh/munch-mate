// Signs dist/munchmate-impresora.exe with Authenticode (signtool, SHA-256, RFC 3161 timestamp) and verifies it.
// Run after build:exe. The certificate comes from the environment (see certificateSource in signing.cjs):
//   SIGN_PFX_PATH + SIGN_PFX_PASSWORD   a .pfx file (CI decodes it from the SIGN_PFX_BASE64 secret)
//   SIGN_CERT_SHA1                      a certificate in the Windows store (USB token, eSigner, SimplySign)
//   SIGN_TIMESTAMP_URL                  optional, default http://timestamp.digicert.com
//   SIGNTOOL_PATH                       optional, otherwise the newest Windows SDK signtool is used
// Without a certificate it does nothing and exits 0: the .exe stays unsigned. With one, any failure exits 1,
// so CI never publishes a release that should have been signed and is not.
// The password goes to signtool as an argument and is never printed (logs mask it; errors are rewritten so
// the command line, which Node includes in the error message, is not shown).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { certificateSource, timestampUrl, signArgs, verifyArgs, redactArgs, newestSdkVersion, sdkArch } =
  require("./signing.cjs");
const { EXE_NAME } = require("./exe-metadata.cjs");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const exe = join(root, "dist", EXE_NAME);

/** @param {string} message */
function fail(message) {
  process.stderr.write(`sign:exe: ${message}\n`);
  process.exit(1);
}

/**
 * Finds signtool.exe: SIGNTOOL_PATH, else the newest `Windows Kits\10\bin\<version>\<arch>\signtool.exe`.
 * @returns {string | null}
 */
function findSigntool() {
  const override = process.env.SIGNTOOL_PATH?.trim();
  if (override) {
    return existsSync(override) ? override : null;
  }
  const programFiles = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const bin = join(programFiles, "Windows Kits", "10", "bin");
  if (!existsSync(bin)) {
    return null;
  }
  const arch = sdkArch(process.arch);
  // Newest first: an SDK folder may lack signtool for this architecture (partial installs).
  const versions = readdirSync(bin);
  while (versions.length > 0) {
    const version = newestSdkVersion(versions);
    if (!version) {
      return null;
    }
    const candidate = join(bin, version, arch, "signtool.exe");
    if (existsSync(candidate)) {
      return candidate;
    }
    versions.splice(versions.indexOf(version), 1);
  }
  return null;
}

/**
 * Runs signtool with inherited output. Never throws Node's error (its message contains the arguments).
 * @param {string} signtool
 * @param {string[]} args
 * @returns {boolean} whether it exited with 0
 */
function run(signtool, args) {
  process.stdout.write(`> signtool ${redactArgs(args).join(" ")}\n`);
  try {
    execFileSync(signtool, args, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

let source;
let tsa;
try {
  source = certificateSource(process.env);
  tsa = timestampUrl(process.env);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (!source) {
  process.stdout.write(
    "sign:exe: sin certificado (SIGN_PFX_PATH o SIGN_CERT_SHA1): el .exe queda sin firmar.\n",
  );
  process.exit(0);
}

if (process.platform !== "win32") {
  fail("firmar requiere signtool de Windows: córrelo en Windows (en CI, el job print-agent-exe).");
}
if (!existsSync(exe)) {
  fail(`falta dist/${EXE_NAME}: corre primero \`pnpm build:exe\`.`);
}
if (source.kind === "pfx" && !existsSync(source.path)) {
  fail("SIGN_PFX_PATH no apunta a un archivo existente.");
}
const signtool = findSigntool();
if (!signtool) {
  fail(
    "no se encontró signtool.exe (Windows SDK, componente \"Signing Tools for Desktop Apps\"). Instálalo o define SIGNTOOL_PATH.",
  );
}

process.stdout.write(
  `sign:exe: firmando con ${source.kind === "pfx" ? "el archivo PFX" : `el certificado ${source.sha1} del almacén de Windows`}, sello de tiempo ${tsa}\n`,
);
if (!run(signtool, signArgs({ source, file: exe, timestampUrl: tsa }))) {
  fail("signtool no pudo firmar el .exe (revisa el certificado, la contraseña y el servidor de sello de tiempo).");
}
if (!run(signtool, verifyArgs(exe))) {
  fail("la firma no se pudo verificar (signtool verify /pa): el .exe no debe publicarse.");
}
process.stdout.write(`sign:exe: dist/${EXE_NAME} firmado y verificado.\n`);
