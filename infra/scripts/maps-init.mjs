#!/usr/bin/env node
// Prepares the self-hosted base map: a PMTiles extract of Chile (OpenStreetMap data, Protomaps build) plus
// the fonts and sprites of the Protomaps basemap style, uploaded to the private bucket under "maps/".
// The api serves them at /api/public/maps/* (same origin, HTTP range requests).
//
// Usage (repo root, dev infra or local stack running, Docker available):
//   node infra/scripts/maps-init.mjs                 # or: pnpm maps:init
// Options (environment variables):
//   MAPS_SOURCE        PMTiles to extract from (URL or local file). Default: the newest daily build found at
//                      https://build.protomaps.com/<YYYYMMDD>.pmtiles (tries the last 10 days).
//   MAPS_MAXZOOM       Default 14 (street level; 15 roughly doubles the size).
//   MAPS_S3_ENDPOINT   Default: S3_ENDPOINT from .env (dev), falling back to https://s3.<DOMAIN> (local stack / VPS).
//   PMTILES_IMAGE      Docker image of the pmtiles CLI. Default protomaps/go-pmtiles. A `pmtiles` binary in PATH
//                      is used instead when present.
// Downloads are cached in .maps-cache/ (gitignored): re-running only uploads again.

import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { lookup as dnsLookup } from "node:dns";
import { Agent } from "node:https";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const CACHE = resolve(".maps-cache");
const ARCHIVE = "chile.pmtiles";
// Mainland Chile plus Chiloé and Magallanes (west, south, east, north). Easter Island is left out on purpose:
// it would stretch the bounding box over the Pacific.
const BBOX = "-75.8,-56.1,-66.3,-17.4";
const MAXZOOM = process.env.MAPS_MAXZOOM ?? "14";
const FONTS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"];
const ASSETS_URL = "https://codeload.github.com/protomaps/basemaps-assets/tar.gz/refs/heads/main";

const env = loadEnv(".env");
const require = createRequire(resolve("apps/api/package.json"));
const { S3Client, PutObjectCommand, HeadBucketCommand } = require("@aws-sdk/client-s3");

function loadEnv(file) {
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return { ...values, ...process.env };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (exit ${result.status})`);
}

function hasCommand(command) {
  return spawnSync(command, ["--help"], { stdio: "ignore" }).status === 0;
}

/** Newest daily planet build that exists (they are published by date, and old ones are removed). */
async function newestBuild() {
  for (let back = 0; back < 10; back++) {
    const day = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
    const url = `https://build.protomaps.com/${day}.pmtiles`;
    const res = await fetch(url, { method: "HEAD" }).catch(() => null);
    if (res?.ok) return url;
  }
  throw new Error("No recent build found at build.protomaps.com; set MAPS_SOURCE to a .pmtiles URL or file");
}

async function extractChile() {
  const target = join(CACHE, ARCHIVE);
  if (existsSync(target)) {
    console.log(`✓ ${ARCHIVE} already in .maps-cache (${(statSync(target).size / 1e6).toFixed(0)} MB)`);
    return target;
  }
  const source = env.MAPS_SOURCE ?? (await newestBuild());
  console.log(`· extracting Chile (z0–${MAXZOOM}) from ${source} — this downloads only the needed tiles`);
  const args = ["extract", source, ARCHIVE, `--bbox=${BBOX}`, `--maxzoom=${MAXZOOM}`];
  if (hasCommand("pmtiles")) {
    run("pmtiles", ["extract", source, target, `--bbox=${BBOX}`, `--maxzoom=${MAXZOOM}`]);
  } else {
    const image = env.PMTILES_IMAGE ?? "protomaps/go-pmtiles";
    const localSource = existsSync(source);
    const mounts = ["-v", `${CACHE}:/data`, "-w", "/data"];
    if (localSource) mounts.push("-v", `${resolve(source)}:/source.pmtiles:ro`);
    run("docker", ["run", "--rm", ...mounts, image, ...args.map((a) => (a === source && localSource ? "/source.pmtiles" : a))]);
  }
  console.log(`✓ ${ARCHIVE} (${(statSync(target).size / 1e6).toFixed(0)} MB)`);
  return target;
}

async function downloadAssets() {
  const dir = join(CACHE, "basemaps-assets-main");
  if (existsSync(dir)) return dir;
  console.log("· downloading fonts and sprites (protomaps/basemaps-assets)");
  const res = await fetch(ASSETS_URL);
  if (!res.ok) throw new Error(`assets download failed: ${res.status}`);
  const tarball = join(CACHE, "basemaps-assets.tar.gz");
  writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
  // Relative path on purpose: GNU tar (Git Bash on Windows) reads "C:\…" as a remote host and fails.
  run("tar", ["-xzf", "basemaps-assets.tar.gz"], { cwd: CACHE });
  return dir;
}

function contentType(file) {
  if (file.endsWith(".pbf")) return "application/x-protobuf";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

/** dns.lookup that sends *.localhost to 127.0.0.1: Node does not resolve those names on every OS (Windows). */
function localhostLookup(hostname, options, callback) {
  if (!hostname.endsWith(".localhost")) return dnsLookup(hostname, options, callback);
  if (options.all) return callback(null, [{ address: "127.0.0.1", family: 4 }]);
  return callback(null, "127.0.0.1", 4);
}

async function s3Client() {
  const credentials = { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY };
  const candidates = [env.MAPS_S3_ENDPOINT, env.S3_ENDPOINT, env.DOMAIN && `https://s3.${env.DOMAIN}`].filter(Boolean);
  // Endpoints that answered with an HTTP error: Garage is up, but its layout, key or bucket is missing.
  const answered = [];
  for (const endpoint of candidates) {
    // The local stack uses Caddy's internal CA, which Node does not trust. Only ever for localhost.
    const local = endpoint.startsWith("https://s3.localhost");
    if (local) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const client = new S3Client({
      endpoint,
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials,
      ...(local ? { requestHandler: { httpsAgent: new Agent({ lookup: localhostLookup }) } } : {}),
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
      console.log(`✓ storage reachable at ${endpoint}`);
      return client;
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      if (status) answered.push(`${endpoint} → HTTP ${status}`);
      client.destroy();
    }
  }
  if (answered.length > 0) {
    throw new Error(
      `Garage answers but the bucket "${env.S3_BUCKET}" is not usable (${answered.join(", ")}). ` +
        "On fresh volumes run `pnpm stack:init` (or `pnpm infra:init` in dev) from Git Bash first.",
    );
  }
  throw new Error(`Garage is not reachable (tried ${candidates.join(", ")}). Is the dev infra or the stack running?`);
}

async function upload(client, file, key) {
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: createReadStream(file),
      ContentLength: statSync(file).size,
      ContentType: contentType(file),
    }),
  );
}

/** Uploads files with a few requests in parallel (a font has 256 small range files). */
async function uploadAll(client, files) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < files.length) {
      const [file, key] = files[next++];
      await upload(client, file, key);
      done++;
      if (done % 100 === 0 || done === files.length) process.stdout.write(`\r  ${done}/${files.length} files`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  process.stdout.write("\n");
}

try {
  mkdirSync(CACHE, { recursive: true });
  const archive = await extractChile();
  const assets = await downloadAssets();
  const client = await s3Client();

  console.log("· uploading the map archive (one large file, may take a minute)");
  await upload(client, archive, `maps/${ARCHIVE}`);

  const files = [];
  for (const font of FONTS) {
    const fontDir = join(assets, "fonts", font);
    if (!existsSync(fontDir)) throw new Error(`font "${font}" not found in the assets`);
    for (const name of readdirSync(fontDir)) files.push([join(fontDir, name), `maps/fonts/${font}/${name}`]);
  }
  const spriteDir = join(assets, "sprites", "v4");
  for (const name of readdirSync(spriteDir).filter((n) => n.startsWith("light"))) {
    files.push([join(spriteDir, name), `maps/sprites/v4/${name}`]);
  }
  console.log("· uploading fonts and sprites");
  await uploadAll(client, files);
  client.destroy();
  console.log("✓ map ready: the api reports it within a minute (GET /api/public/map-config → available: true)");
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}
