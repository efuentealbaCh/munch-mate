#!/usr/bin/env node
// Makes this computer trust the local stack's HTTPS (https://localhost, media.localhost, s3.localhost): copies the
// root certificate of Caddy's local CA out of the caddy container into .local-ca/caddy-root.crt (gitignored) and,
// on Windows, installs it in the current user's "Trusted Root Certification Authorities" store (no admin needed;
// Windows asks for confirmation once). Chrome, Edge and Brave use that store. Without it, the browser blocks the
// photos served from media.localhost without saying why.
//
// Usage (from the repo root, with `pnpm stack:up` running):
//   node infra/scripts/trust-cert.mjs            # export + install (skipped when already installed)
//   node infra/scripts/trust-cert.mjs --export   # only export the file (Node tools: NODE_EXTRA_CA_CERTS)
//
// The certificate only changes when Caddy's volumes are deleted (`down -v`); `pnpm demo:reset` keeps them.
// Firefox keeps its own store: set security.enterprise_roots.enabled = true in about:config to use Windows'.
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CONTAINER_PATH = "/data/caddy/pki/authorities/local/root.crt";
const OUT_DIR = ".local-ca";
const OUT_FILE = resolve(join(OUT_DIR, "caddy-root.crt"));
const exportOnly = process.argv.includes("--export");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Copies the root certificate out of the caddy container (it appears a moment after Caddy first starts). */
async function exportCertificate() {
  const id = run("docker", ["compose", "-f", "compose.yaml", "ps", "-q", "caddy"]);
  if (!id) throw new Error("El contenedor de Caddy no está corriendo: levanta el stack con pnpm stack:up.");
  mkdirSync(OUT_DIR, { recursive: true });
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      run("docker", ["cp", `${id}:${CONTAINER_PATH}`, OUT_FILE]);
      return new X509Certificate(readFileSync(OUT_FILE));
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`Caddy todavía no creó su certificado local (${CONTAINER_PATH}). ¿El stack usa DOMAIN=localhost?`);
}

/** Windows: installs the certificate for the current user unless that exact one is already there. */
function trustOnWindows(certificate) {
  const thumbprint = certificate.fingerprint.replaceAll(":", "");
  const ps = (script) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  // The thumbprint is hex and the path is ours, so interpolating them into the command is safe.
  if (ps(`Test-Path 'Cert:\\CurrentUser\\Root\\${thumbprint}'`) === "True") {
    console.log("✓ Windows ya confía en el certificado local de Caddy.");
    return;
  }
  console.log("Windows va a pedir que confirmes la instalación del certificado: responde «Sí».");
  ps(`Import-Certificate -FilePath '${OUT_FILE}' -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null`);
  if (ps(`Test-Path 'Cert:\\CurrentUser\\Root\\${thumbprint}'`) !== "True") {
    throw new Error("No se instaló el certificado (¿respondiste «No» en el aviso de Windows?). Vuelve a correr pnpm cert:trust.");
  }
  console.log("✓ Certificado instalado. Cierra el navegador por completo y ábrelo de nuevo.");
}

try {
  const certificate = await exportCertificate();
  console.log(`✓ Certificado local de Caddy en ${OUT_DIR}/caddy-root.crt (${certificate.subject.replace(/\n/g, ", ")})`);
  if (exportOnly) process.exit(0);
  if (process.platform === "win32") {
    trustOnWindows(certificate);
  } else {
    console.log("• Fuera de Windows instálalo a mano en el almacén del sistema:");
    console.log(`    macOS: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${OUT_FILE}`);
    console.log(`    Linux (Debian/Ubuntu): sudo cp ${OUT_FILE} /usr/local/share/ca-certificates/ && sudo update-ca-certificates`);
  }
  console.log(`• Herramientas de Node (agente de impresión): NODE_EXTRA_CA_CERTS=${OUT_FILE}`);
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}
