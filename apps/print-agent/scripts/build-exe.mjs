// Builds dist/munchmate-impresora.exe: a Node single executable application (SEA) with dist/agent.cjs inside,
// so the restaurant's computer needs no Node installed. Run on Windows (CI: windows-latest) after `bundle`:
//   1. node --experimental-sea-config sea-config.json  → dist/sea-prep.blob
//   2. copy the running node.exe                       → dist/munchmate-impresora.exe
//   3. postject: inject the blob as NODE_SEA_BLOB, flipping the SEA sentinel fuse
// The .exe embeds the Node version that runs this script (CI uses .nvmrc = 24). It is not signed: Windows
// SmartScreen warns on first run until it is signed with a code-signing certificate (pending).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const bundle = join(dist, "agent.cjs");
const blob = join(dist, "sea-prep.blob");
const exe = join(dist, "munchmate-impresora.exe");
const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

if (process.platform !== "win32") {
  process.stderr.write("build:exe genera un .exe de Windows: córrelo en Windows (en CI, el job print-agent-exe en windows-latest).\n");
  process.exit(1);
}
if (!existsSync(bundle)) {
  process.stderr.write("Falta dist/agent.cjs: corre primero `pnpm bundle`.\n");
  process.exit(1);
}

execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], { cwd: root, stdio: "inherit" });

rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);

const require = createRequire(import.meta.url);
const { inject } = require("postject");
await inject(exe, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: SENTINEL_FUSE });
rmSync(blob, { force: true });

const size = statSync(exe).size;
process.stdout.write(`dist/munchmate-impresora.exe (${(size / 1024 / 1024).toFixed(1)} MB, Node ${process.version})\n`);
