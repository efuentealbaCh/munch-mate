// Copies MapLibre's web worker (and the chunk it imports) to public/maplibre/, served same-origin.
// MapLibre 6 finds its worker next to its own module through import.meta.url, which Next's bundler
// rewrites, so the map would start without a worker. components/map/base-map.tsx points setWorkerUrl here.
// Runs before `next dev` and `next build`; the copies are generated (gitignored), never edited by hand.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");

mkdirSync(target, { recursive: true });
for (const file of FILES) {
  const source = fileURLToPath(import.meta.resolve(`maplibre-gl/dist/${file}`));
  copyFileSync(source, join(target, file));
}
