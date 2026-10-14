// Builds dist/munchmate-impresora.exe: a Node single executable application (SEA) with dist/agent.cjs inside,
// so the restaurant's computer needs no Node installed. Run on Windows (CI: windows-latest) after `bundle`:
//   1. node --experimental-sea-config sea-config.json  → dist/sea-prep.blob
//   2. copy the running node.exe and rewrite its resources (resedit): our icon (assets/icon.ico), version info
//      (Munch Mate Impresora, version from package.json) and an asInvoker manifest. Writing the file back drops
//      node.exe's Authenticode signature, which the edit would invalidate anyway (and postject then reports
//      "signature seems corrupted"). Done BEFORE postject: Node's docs warn that editing the binary after the
//      blob is injected can break it.
//   3. postject: inject the blob as NODE_SEA_BLOB, flipping the SEA sentinel fuse
//   4. run the .exe with --version to prove it starts
// The .exe embeds the Node version that runs this script (CI uses .nvmrc = 24). It is unsigned: `pnpm sign:exe`
// signs it when a certificate is configured (see the README, "Firma del ejecutable").
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ResEdit from "resedit";

const require = createRequire(import.meta.url);
const { EXE_NAME, versionStrings, asInvokerManifest } = require("./exe-metadata.cjs");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const bundle = join(dist, "agent.cjs");
const blob = join(dist, "sea-prep.blob");
const exe = join(dist, EXE_NAME);
const icon = join(root, "assets", "icon.ico");
const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const RT_MANIFEST = 24;

if (process.platform !== "win32") {
  process.stderr.write("build:exe genera un .exe de Windows: córrelo en Windows (en CI, el job print-agent-exe en windows-latest).\n");
  process.exit(1);
}
if (!existsSync(bundle)) {
  process.stderr.write("Falta dist/agent.cjs: corre primero `pnpm bundle`.\n");
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * Replaces icon, version info and manifest of the copied node.exe, and drops its (now invalid) signature.
 * @param {string} file the .exe to rewrite in place
 */
function brandExecutable(file) {
  // ignoreCert: node.exe is signed; generate() writes the file without the certificate table.
  const executable = ResEdit.NtExecutable.from(readFileSync(file), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(executable);

  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  if (iconGroups.length === 0) {
    throw new Error("node.exe no trae ícono: no hay grupo de íconos que reemplazar");
  }
  const icons = ResEdit.Data.IconFile.from(readFileSync(icon)).icons.map((item) => item.data);
  for (const group of iconGroups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  }

  const [versionInfo] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (!versionInfo) {
    throw new Error("node.exe no trae recursos de versión");
  }
  const strings = versionStrings({ version, year: new Date().getFullYear(), nodeVersion: process.version });
  // Same language/codepage node.exe uses (en-US, UTF-16); every Node value is removed first.
  const languages = versionInfo.getAllLanguagesForStringValues();
  for (const language of languages) {
    versionInfo.removeAllStringValues(language, false);
    versionInfo.setStringValues(language, strings);
  }
  versionInfo.setFileVersion(strings.FileVersion);
  versionInfo.setProductVersion(strings.ProductVersion);
  versionInfo.outputToResourceEntries(resources.entries);

  const manifests = resources.entries.filter((entry) => entry.type === RT_MANIFEST);
  if (manifests.length === 0) {
    throw new Error("node.exe no trae manifiesto de aplicación");
  }
  for (const entry of manifests) {
    const xml = asInvokerManifest(Buffer.from(entry.bin).toString("utf8"));
    const bytes = Buffer.from(xml, "utf8");
    entry.bin = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  // allowShrink: our icon is much smaller than Node's. Without it resedit keeps the old raw size of .rsrc while
  // moving .reloc down in memory, so the raw data overlaps .reloc's address range and postject's parser (LIEF)
  // reads the relocations from the wrong place ("Relocation corrupted: BlockSize is out of bound").
  resources.outputResource(executable, false, true);
  writeFileSync(file, Buffer.from(executable.generate()));
}

execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], { cwd: root, stdio: "inherit" });

rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);
brandExecutable(exe);

const { inject } = require("postject");
await inject(exe, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: SENTINEL_FUSE });
rmSync(blob, { force: true });

// Smoke check: a broken injection or resource edit shows up here, not on the restaurant's computer.
const reported = execFileSync(exe, ["--version"], { encoding: "utf8", timeout: 30_000 }).trim();
if (!reported.includes(version)) {
  process.stderr.write(`El .exe arrancó pero informó "${reported}" (se esperaba la versión ${version}).\n`);
  process.exit(1);
}

const size = statSync(exe).size;
process.stdout.write(`dist/${EXE_NAME} (${(size / 1024 / 1024).toFixed(1)} MB, Node ${process.version}, agente ${version})\n`);
