#!/usr/bin/env node
// Creates the demo restaurants of infra/demo/demo-restaurants.json through the public api, exactly as a
// user would: register (or log in), verify the email via Mailpit, create restaurants, profile, logo,
// modifier groups, categories and products with photos, tables, and open the restaurant for orders.
//
// Usage (from the repo root, with the local stack or `pnpm dev` running):
//   node infra/scripts/seed-demo.mjs
// Environment:
//   BASE_URL       default https://localhost (`pnpm stack:up`); use http://localhost:3100 for `pnpm dev`
//   MAILPIT_URL    default http://127.0.0.1:8025 (needed only if the demo account is not verified yet)
//   DEMO_EMAIL     default demo@munchmate.local
//   DEMO_PASSWORD  default "munchmate demo 2026"
//
// Idempotent: restaurants that already exist in the demo account (same name) are skipped.
// Photos are downloaded once into .demo-cache/ (gitignored).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env.BASE_URL ?? "https://localhost").replace(/\/+$/, "");
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const EMAIL = process.env.DEMO_EMAIL ?? "demo@munchmate.local";
const PASSWORD = process.env.DEMO_PASSWORD ?? "munchmate demo 2026";
const CACHE_DIR = ".demo-cache";
const USER_AGENT = "munch-mate-demo-seed/1.0 (https://github.com/efuentealbaCh/munch-mate)";

const url = new URL(BASE_URL);
if (url.protocol === "https:" && url.hostname === "localhost") {
  // The local stack uses Caddy's internal CA, which Node does not trust. Only ever for localhost.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const data = JSON.parse(readFileSync("infra/demo/demo-restaurants.json", "utf8"));
const cookies = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls the api with the session cookies and the app's Origin (required by the CSRF guard).
 * Waits and retries on 429 (Retry-After) so the seed respects the api's rate limits.
 * @returns Parsed JSON body (or null for 204).
 */
async function api(method, path, body) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const headers = { Origin: BASE_URL, Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${BASE_URL}/api${path}`, { method, headers, body: payload });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, ...value] = pair.split("=");
      cookies.set(name.trim(), value.join("="));
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? "10");
      process.stdout.write(`  · rate limited, waiting ${wait}s…\n`);
      await sleep((wait + 1) * 1000);
      continue;
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const error = new Error(`${method} ${path} → ${res.status} ${json?.code ?? ""}: ${json?.message ?? text}`);
      error.status = res.status;
      error.code = json?.code;
      throw error;
    }
    return json;
  }
  throw new Error(`${method} ${path}: still rate limited after several retries`);
}

/** Logs in, or registers the demo owner; then makes sure the email is verified (needed to create restaurants). */
async function ensureOwner() {
  let profile;
  try {
    profile = await api("POST", "/auth/login", { email: EMAIL, password: PASSWORD });
    console.log(`✓ logged in as ${EMAIL}`);
  } catch (error) {
    if (error.code !== "INVALID_CREDENTIALS") throw error;
    profile = await api("POST", "/auth/register", { email: EMAIL, password: PASSWORD, name: data.owner.name });
    console.log(`✓ registered ${EMAIL}`);
  }
  if (profile.emailVerified) return;

  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await (await fetch(`${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(EMAIL)}`)).json();
    const id = search.messages?.[0]?.ID;
    if (id) {
      const message = await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json();
      const token = message.Text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
      if (token) {
        await api("POST", "/auth/verify-email", { token });
        console.log("✓ email verified (link read from Mailpit)");
        return;
      }
    }
    await sleep(1000);
  }
  throw new Error(`Could not find the verification email for ${EMAIL} in Mailpit (${MAILPIT_URL})`);
}

/**
 * Returns a photo as a Blob, downloading it once. Uses a 1280 px Commons thumbnail when available (the
 * originals can exceed the 8 MB upload limit) and falls back to the original file.
 */
async function photo(key) {
  const file = join(CACHE_DIR, `${key}.jpg`);
  if (!existsSync(file)) {
    const { url: original } = data.photos[key];
    const match = original.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/(.+)\/([^/]+)$/);
    const candidates = match ? [`${match[1]}/thumb/${match[2]}/${match[3]}/1280px-${match[3]}`, original] : [original];
    let bytes;
    for (const candidate of candidates) {
      // Wikimedia rate-limits bursts with 429 + Retry-After: wait and retry instead of failing the seed.
      for (let attempt = 0; attempt < 6 && !bytes; attempt++) {
        const res = await fetch(candidate, { headers: { "User-Agent": USER_AGENT } });
        if (res.ok) bytes = Buffer.from(await res.arrayBuffer());
        else if (res.status === 429) await sleep((Number(res.headers.get("retry-after") ?? "10") + 1) * 1000);
        else break;
      }
      if (bytes) break;
    }
    await sleep(500); // be gentle with Wikimedia between downloads
    if (!bytes) throw new Error(`Could not download photo ${key}`);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, bytes);
  }
  return new Blob([readFileSync(file)], { type: "image/jpeg" });
}

async function upload(path, key) {
  const form = new FormData();
  form.append("file", await photo(key), `${key}.jpg`);
  return api("PUT", path, form);
}

/** Identifies a modifier group by name + option names (two groups may share a name, e.g. "Tamaño"). */
const groupSignature = (group) => `${group.name}|${group.options.map((o) => o.name).join(",")}`;

/**
 * Creates whatever is missing of one demo restaurant. Matching is by name, so a run interrupted halfway
 * (network error, rate limit) is completed by running the script again; nothing is duplicated.
 */
async function seedRestaurant(spec, existing) {
  let restaurant = existing.find((r) => r.name === spec.name);
  if (!restaurant) restaurant = await api("POST", "/restaurants", { name: spec.name });
  const base = `/restaurants/${restaurant.id}`;

  restaurant = await api("PATCH", base, { description: spec.description, phone: spec.phone });
  if (!restaurant.logo) await upload(`${base}/logo`, spec.logo);

  const menu = await api("GET", `${base}/menu`);
  const groupIds = {};
  for (const group of spec.modifierGroups) {
    const found = menu.modifierGroups.find((g) => groupSignature(g) === groupSignature(group));
    groupIds[group.key] =
      found?.id ??
      (
        await api("POST", `${base}/menu/modifier-groups`, {
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          options: group.options,
        })
      ).id;
  }

  let created = 0;
  let total = 0;
  for (const category of spec.categories) {
    const categoryId =
      menu.categories.find((c) => c.name === category.name)?.id ??
      (
        await api("POST", `${base}/menu/categories`, {
          name: category.name,
          ...(category.description ? { description: category.description } : {}),
        })
      ).id;

    for (const item of category.products) {
      let product = menu.products.find((p) => p.categoryId === categoryId && p.name === item.name);
      if (!product) {
        product = await api("POST", `${base}/menu/products`, {
          categoryId,
          name: item.name,
          description: item.description ?? "",
          price: item.price,
          modifierGroupIds: (item.groups ?? []).map((key) => groupIds[key]),
        });
        created++;
      }
      if (item.photo && !product.image) await upload(`${base}/menu/products/${product.id}/image`, item.photo);
      const available = item.available !== false;
      if (product.available !== available) {
        await api("PATCH", `${base}/menu/products/${product.id}/availability`, { available });
      }
      total++;
      process.stdout.write(`\r  ${spec.name}: ${total} productos`);
    }
  }
  process.stdout.write("\n");

  // Phase 3: tables (matched by label) and open for orders, so the demo can be ordered from right away.
  const tables = await api("GET", `${base}/tables`);
  for (const label of spec.tables ?? []) {
    if (!tables.some((t) => t.label === label)) tables.push(await api("POST", `${base}/tables`, { label }));
  }
  if (spec.acceptingOrders !== undefined && restaurant.acceptingOrders !== spec.acceptingOrders) {
    await api("PUT", `${base}/accepting-orders`, { acceptingOrders: spec.acceptingOrders });
  }

  console.log(`✓ ${spec.name} → /r/${restaurant.slug} (${created} productos nuevos, ${tables.length} mesas)`);
  return { ...restaurant, tables };
}

try {
  console.log(`Seeding demo data into ${BASE_URL}`);
  await ensureOwner();
  const existing = await api("GET", "/restaurants");
  const restaurants = [];
  for (const spec of data.restaurants) restaurants.push(await seedRestaurant(spec, existing));

  console.log("\nDemo lista:");
  console.log(`  Cuenta:      ${EMAIL} / ${PASSWORD}`);
  console.log(`  Panel:       ${BASE_URL}/admin`);
  for (const r of restaurants) {
    console.log(`  ${r.name}`);
    console.log(`    Menú público: ${BASE_URL}/r/${r.slug}`);
    const first = r.tables?.[0];
    if (first) console.log(`    Pedir desde ${first.label}: ${BASE_URL}/m/${first.token}`);
  }
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}
