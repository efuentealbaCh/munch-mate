// Bundles the agent and every dependency (socket.io-client, @app/types, @app/utils) into one CommonJS file,
// dist/agent.cjs: what the Node single executable (build:exe) embeds, and runnable with `node dist/agent.cjs`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const result = await build({
  entryPoints: [join(root, "src/cli.ts")],
  outfile: join(root, "dist/agent.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  // @app/* resolve to their built dist (run `pnpm --filter "./packages/*" build` first).
  mainFields: ["main", "module"],
  // Optional native speed-ups of `ws` (used by socket.io-client on Node): not installed, ws works without them.
  external: ["bufferutil", "utf-8-validate"],
  sourcemap: false,
  minify: false,
  legalComments: "eof",
  banner: { js: `/* Munch Mate print agent ${version} */` },
  logLevel: "warning",
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0);
process.stdout.write(`dist/agent.cjs (${(bytes / 1024).toFixed(0)} KB)\n`);
