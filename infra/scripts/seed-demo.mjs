#!/usr/bin/env node
// Creates the demo restaurants of infra/demo/demo-restaurants.json through the public api, exactly as a
// user would: register (or log in), verify the email via Mailpit, create restaurants, profile, logo,
// modifier groups, categories and products with photos and discounts, tables, pickup, delivery zones drawn on the
// map, the restaurant location, WhatsApp notices, and open the restaurant for orders. It also creates the demo
// rider (repartidor@munchmate.local, same password), invited with the rider role to the restaurants that deliver,
// and today's sample orders of each restaurant (`orders` and `tableActions` in the JSON): table, pickup and
// delivery orders in every status, table accounts called, split and charged, so every screen has data.
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

import { createHash } from "node:crypto";
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
 * @param jar Session cookies to send and update: the owner's by default, the rider's for their own calls.
 * @returns Parsed JSON body (or null for 204).
 */
async function api(method, path, body, jar = cookies) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const headers = { Origin: BASE_URL, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") };
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${BASE_URL}/api${path}`, { method, headers, body: payload });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, ...value] = pair.split("=");
      jar.set(name.trim(), value.join("="));
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
 * The demo rider (delivery walkthrough, step 22 of the guide): an account invited with the rider role to every
 * restaurant that delivers, exactly as an owner would do it. Reused on later runs.
 */
const RIDER = { email: "repartidor@munchmate.local", name: "Rodrigo Reparto" };

/** IDs of the emails Mailpit holds for `to`. */
async function emailIds(to) {
  const search = await (await fetch(`${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(to)}`)).json();
  return (search.messages ?? []).map((message) => message.ID);
}

/**
 * Link to `path` in an email sent to `to` that was not in `before` (read from Mailpit), waiting up to 20 s.
 * Skipping the older emails matters: the invitation to a second restaurant must not pick the first one's link.
 */
async function emailToken(to, path, before) {
  const pattern = new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`);
  for (let attempt = 0; attempt < 20; attempt++) {
    for (const ID of (await emailIds(to)).filter((id) => !before.includes(id))) {
      const message = await (await fetch(`${MAILPIT_URL}/api/v1/message/${ID}`)).json();
      const token = message.Text?.match(pattern)?.[1];
      if (token) return token;
    }
    await sleep(1000);
  }
  throw new Error(`Could not find an email to ${to} with a ${path} link in Mailpit (${MAILPIT_URL})`);
}

/** @returns The rider's session, to act on their deliveries (null when no restaurant delivers). */
async function ensureRider(restaurants) {
  const delivering = restaurants.filter((r) => r.deliveryEnabled);
  if (delivering.length === 0) return null;
  const jar = new Map();
  try {
    await api("POST", "/auth/login", { email: RIDER.email, password: PASSWORD }, jar);
  } catch (error) {
    if (error.code !== "INVALID_CREDENTIALS") throw error;
    await api("POST", "/auth/register", { email: RIDER.email, password: PASSWORD, name: RIDER.name }, jar);
    console.log(`✓ registered ${RIDER.email}`);
  }
  for (const restaurant of delivering) {
    const riders = await api("GET", `/restaurants/${restaurant.id}/riders`);
    if (riders.some((rider) => rider.name === RIDER.name)) continue;
    const before = await emailIds(RIDER.email);
    await api("POST", `/restaurants/${restaurant.id}/invitations`, { email: RIDER.email, roles: ["rider"] });
    const token = await emailToken(RIDER.email, "/invitacion", before);
    await api("POST", "/invitations/accept", { token }, jar);
    console.log(`✓ ${RIDER.name} es repartidor de ${restaurant.name}`);
  }
  return jar;
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

  restaurant = await api("PATCH", base, {
    description: spec.description,
    phone: spec.phone,
    ...(spec.pickupEnabled !== undefined ? { pickupEnabled: spec.pickupEnabled } : {}),
    ...(spec.deliveryEnabled !== undefined ? { deliveryEnabled: spec.deliveryEnabled } : {}),
    ...(spec.location ? { location: spec.location } : {}),
    // Phase 8: WhatsApp/SMS notices (offered only where the platform has a messaging provider).
    ...(spec.messaging ? { messaging: spec.messaging } : {}),
  });
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
      // Phase 8: the demo discounts (kept if the owner changed them since).
      if (item.promo && !product.promo) await api("PUT", `${base}/menu/products/${product.id}/promo`, item.promo);
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
  // Phase 5/7: delivery zones, matched by name, with their (approximate) area on the map. Zones created by
  // an earlier run without an area get it now.
  const zones = await api("GET", `${base}/delivery-zones`);
  for (const zone of spec.deliveryZones ?? []) {
    const existing = zones.find((z) => z.name === zone.name);
    if (!existing) zones.push(await api("POST", `${base}/delivery-zones`, zone));
    else if (zone.area && !existing.area) await api("PATCH", `${base}/delivery-zones/${existing.id}`, { area: zone.area });
  }

  // Phase 9: the floor plan of the live view (tables matched by label). Only when the restaurant has none: a plan
  // the owner already edited is never replaced.
  if (spec.floorPlan) {
    const current = await api("GET", `${base}/floor-plan`);
    if (!current.plan) {
      const { tables: places, ...plan } = spec.floorPlan;
      await api("PUT", `${base}/floor-plan`, {
        plan,
        tables: current.tables.map((table) => {
          const place = places.find((p) => p.label === table.label);
          if (!place) return { tableId: table.id, layout: null };
          const layout = { x: place.x, y: place.y, shape: place.shape, seats: place.seats };
          // Optional: 90 = vertical (a long table one cell under the other); missing = horizontal.
          if (place.rotation !== undefined) layout.rotation = place.rotation;
          return { tableId: table.id, layout };
        }),
      });
      console.log(`✓ ${spec.name}: plano del local con ${places.length} mesas`);
    }
  }

  if (spec.acceptingOrders !== undefined && restaurant.acceptingOrders !== spec.acceptingOrders) {
    await api("PUT", `${base}/accepting-orders`, { acceptingOrders: spec.acceptingOrders });
  }

  console.log(`✓ ${spec.name} → /r/${restaurant.slug} (${created} productos nuevos, ${tables.length} mesas)`);
  return { ...restaurant, tables };
}

/** Business day (YYYY-MM-DD) in the restaurant's timezone, like the api's `businessDate`. */
const localDay = (timeZone, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/**
 * The `clientOrderId` of a demo order: a UUID v4 derived from restaurant, day and case. Order creation is
 * idempotent per `clientOrderId`, so running the seed again the same day finds the same orders.
 */
function caseOrderId(restaurantId, day, key) {
  const hex = createHash("sha256").update(`demo-order:${restaurantId}:${day}:${key}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Cart lines from product and option names, as the public menu would send them. Groups that require a choice
 * and are not named get their first available option.
 */
function orderItems(menu, items) {
  const products = menu.categories.flatMap((category) => category.products);
  return items.map(({ product: name, quantity = 1, options = {}, note }) => {
    const product = products.find((p) => p.name === name);
    if (!product) throw new Error(`Demo order: "${name}" is not on the public menu`);
    for (const group of Object.keys(options)) {
      if (!product.modifierGroups.some((g) => g.name === group)) throw new Error(`Demo order: "${name}" has no "${group}"`);
    }
    const modifiers = product.modifierGroups
      .map((group) => {
        const chosen = options[group.name] ?? (group.minSelect > 0 ? [group.options.find((o) => o.available).name] : []);
        const optionIds = chosen.map((optionName) => {
          const option = group.options.find((o) => o.name === optionName);
          if (!option) throw new Error(`Demo order: "${group.name}" of "${name}" has no "${optionName}"`);
          return option.id;
        });
        return { groupId: group.id, optionIds };
      })
      .filter((modifier) => modifier.optionIds.length > 0);
    return { productId: product.id, quantity, modifiers, ...(note ? { note } : {}) };
  });
}

/** A pin inside the zone's area (the centroid, or halfway to a vertex for odd shapes), checked by the api. */
async function pinInside(slug, zone) {
  const center = {
    lat: zone.area.reduce((sum, p) => sum + p.lat, 0) / zone.area.length,
    lng: zone.area.reduce((sum, p) => sum + p.lng, 0) / zone.area.length,
  };
  const candidates = [center, ...zone.area.map((p) => ({ lat: (center.lat + p.lat) / 2, lng: (center.lng + p.lng) / 2 }))];
  for (const candidate of candidates) {
    const pin = { lat: Number(candidate.lat.toFixed(6)), lng: Number(candidate.lng.toFixed(6)) };
    try {
      const found = await api("POST", `/public/restaurants/${slug}/delivery-zones/locate`, pin);
      if (found.id === zone.id) return pin;
    } catch (error) {
      if (error.code !== "OUT_OF_DELIVERY_AREA") throw error;
    }
  }
  throw new Error(`Demo order: no point found inside the zone ${zone.name}`);
}

/** Statuses each channel goes through (`@app/utils` state machine), up to the final one. */
const STATUS_PATHS = {
  dine_in: ["pending", "accepted", "preparing", "ready", "served"],
  pickup: ["pending", "accepted", "preparing", "ready", "picked_up"],
  delivery: ["pending", "accepted", "preparing", "ready", "out_for_delivery", "delivered"],
};
const READY_IN_MINUTES = { pickup: 20, delivery: 45 };

/**
 * Takes a demo order to the status of its case through the staff routes, as the board would: accepting with a
 * ready time, the rider taking the delivery out and collecting the payment, rejecting or cancelling with a reason.
 * Steps already done are skipped, so a second run changes nothing.
 */
async function advance(base, order, demo, rider) {
  const path = STATUS_PATHS[order.channel];
  if (!path.includes(order.status)) return order; // already rejected or cancelled
  // Rejected orders leave the path while pending; cancelled ones once accepted (the staff gives the reason).
  const stop = demo.status === "rejected" ? "pending" : demo.status === "cancelled" ? "accepted" : demo.status;
  let current = order;
  const byRider = (status) => demo.rider && ["out_for_delivery", "delivered"].includes(status);
  const pay = async (asRider) => {
    if (!demo.paid || current.paymentStatus === "paid") return;
    current = asRider
      ? await api("POST", `${base}/deliveries/${current.id}/payment`, { method: demo.paid }, rider.jar)
      : await api("POST", `${base}/orders/${current.id}/payment`, { method: demo.paid });
  };

  for (const status of path.slice(path.indexOf(current.status) + 1, path.indexOf(stop) + 1)) {
    if (status === "out_for_delivery" && demo.rider && !current.rider) {
      current = await api("PUT", `${base}/orders/${current.id}/rider`, { riderId: rider.id });
    }
    if (status === path.at(-1)) await pay(byRider(status));
    const body = { status, ...(status === "accepted" && READY_IN_MINUTES[current.channel] ? { readyInMinutes: READY_IN_MINUTES[current.channel] } : {}) };
    current = byRider(status)
      ? await api("POST", `${base}/deliveries/${current.id}/status`, body, rider.jar)
      : await api("POST", `${base}/orders/${current.id}/status`, body);
  }
  // Assigned ahead of time: the rider sees the delivery coming while it is still in the kitchen.
  if (demo.rider && !current.rider && path.indexOf(current.status) < path.indexOf("out_for_delivery")) {
    current = await api("PUT", `${base}/orders/${current.id}/rider`, { riderId: rider.id });
  }
  await pay(false); // paid before it is handed over (e.g. a pickup order waiting at the counter)
  if (["rejected", "cancelled"].includes(demo.status) && current.status === stop) {
    current = await api("POST", `${base}/orders/${current.id}/status`, { status: demo.status, reason: demo.reason });
  }
  return current;
}

/**
 * Today's sample orders of one restaurant, so every screen has something to show: the kitchen board in every
 * status, table accounts (a waiter call, a bill request with tip, a split account half paid, a closed one),
 * pickup and delivery orders with the demo rider, rejected and cancelled ones, and the day's sales.
 * Customers order without a session, from the public routes; the staff work them as the owner.
 *
 * Idempotent per day. Skipped when there are orders in progress or open accounts from an earlier day (a demo
 * loaded yesterday): new cases would mix with them. `pnpm demo:reset` starts from scratch.
 */
async function seedOrders(spec, restaurant, rider) {
  if (!spec.orders?.length) return;
  const base = `/restaurants/${restaurant.id}`;
  const menu = await api("GET", `/public/restaurants/${restaurant.slug}/menu`);
  const { timezone } = menu.restaurant;
  const today = localDay(timezone);
  const active = await api("GET", `${base}/orders?scope=active`);
  const open = await api("GET", `${base}/table-sessions`);
  if (active.some((o) => o.businessDate !== today) || open.some((s) => localDay(timezone, new Date(s.openedAt)) !== today)) {
    console.log(`• ${spec.name}: hay pedidos o mesas abiertas de otro día, no se agregan pedidos de ejemplo (pnpm demo:reset parte de cero)`);
    return;
  }

  const zones = spec.orders.some((o) => o.delivery) ? await api("GET", `${base}/delivery-zones`) : [];
  const guest = new Map(); // customers order without a session
  const tracking = [];
  for (const demo of spec.orders) {
    const body = {
      clientOrderId: caseOrderId(restaurant.id, today, demo.key),
      items: orderItems(menu, demo.items),
      ...(demo.customerName ? { customerName: demo.customerName } : {}),
      ...(demo.customerPhone ? { customerPhone: demo.customerPhone } : {}),
      ...(demo.note ? { note: demo.note } : {}),
    };
    let created;
    if (demo.table) {
      const table = restaurant.tables.find((t) => t.label === demo.table);
      if (!table) throw new Error(`Demo order ${demo.key}: no table ${demo.table}`);
      created = await api("POST", `/public/tables/${table.token}/orders`, body, guest);
    } else if (demo.delivery) {
      const { zone: zoneName, ...address } = demo.delivery;
      const zone = zones.find((z) => z.name === zoneName);
      if (!zone) throw new Error(`Demo order ${demo.key}: no delivery zone ${zoneName}`);
      const location = zone.area ? await pinInside(restaurant.slug, zone) : undefined;
      created = await api(
        "POST",
        `/public/restaurants/${restaurant.slug}/delivery-orders`,
        { ...body, delivery: { zoneId: zone.id, ...address, ...(location ? { location } : {}) }, payment: demo.payment },
        guest,
      );
    } else {
      created = await api("POST", `/public/restaurants/${restaurant.slug}/orders`, body, guest);
    }
    const order = (await api("GET", `${base}/orders?scope=today`)).find((o) => o.number === created.order.number);
    if (demo.rider && !rider) throw new Error(`Demo order ${demo.key}: the demo rider is missing`);
    const final = await advance(base, order, demo, rider);
    if (final.status === "out_for_delivery") tracking.push(`${BASE_URL}/pedido#t=${created.accessToken}`);
    process.stdout.write(`\r  ${spec.name}: ${spec.orders.indexOf(demo) + 1}/${spec.orders.length} pedidos de ejemplo`);
  }
  process.stdout.write("\n");

  // The table side: calling the waiter and asking for the bill from the QR, splitting and charging in «Salón».
  const sessionOf = async (label) => (await api("GET", `${base}/table-sessions`)).find((s) => s.tableLabel === label);
  for (const action of spec.tableActions ?? []) {
    const table = restaurant.tables.find((t) => t.label === action.table);
    let session = await sessionOf(action.table);
    if (!table || !session) continue; // closed by an earlier run
    if (action.callWaiter && !session.waiterCalledAt) {
      await api("POST", `/public/tables/${table.token}/call-waiter`, undefined, guest);
    }
    if (action.requestBill && !session.billRequestedAt) {
      await api("POST", `/public/tables/${table.token}/request-bill`, { tip: action.requestBill }, guest);
    }
    if (action.split && !session.split) {
      session = await api("PUT", `${base}/table-sessions/${session.id}/split`, { mode: "equal", parts: action.split });
    }
    for (const { part, method, tip } of action.payParts ?? []) {
      if (session.payments.some((p) => p.part === part)) continue;
      session = await api("POST", `${base}/table-sessions/${session.id}/payments`, { kind: "equal", part, method, tip });
    }
    if (action.close) {
      const tip = action.close.tip === "suggested" ? session.suggestedTip : 0;
      await api("POST", `${base}/table-sessions/${session.id}/close`, { method: action.close.method, tip });
    }
  }

  console.log(`✓ ${spec.name}: ${spec.orders.length} pedidos de ejemplo de hoy`);
  for (const link of tracking) console.log(`    Seguimiento de un delivery en camino: ${link}`);
}

try {
  console.log(`Seeding demo data into ${BASE_URL}`);
  await ensureOwner();
  const existing = await api("GET", "/restaurants");
  const restaurants = [];
  for (const spec of data.restaurants) restaurants.push(await seedRestaurant(spec, existing));
  const riderJar = await ensureRider(restaurants);

  console.log("\nPedidos de ejemplo:");
  for (const [index, spec] of data.restaurants.entries()) {
    const restaurant = restaurants[index];
    const riderId =
      riderJar && restaurant.deliveryEnabled
        ? (await api("GET", `/restaurants/${restaurant.id}/riders`)).find((r) => r.name === RIDER.name)?.id
        : undefined;
    await seedOrders(spec, restaurant, riderId ? { id: riderId, jar: riderJar } : null);
  }

  console.log("\nDemo lista:");
  console.log(`  Cuenta:      ${EMAIL} / ${PASSWORD}`);
  console.log(`  Repartidor:  ${RIDER.email} / ${PASSWORD}`);
  console.log(`  Panel:       ${BASE_URL}/admin`);
  for (const r of restaurants) {
    console.log(`  ${r.name}`);
    const channels = [r.pickupEnabled && "retiro", r.deliveryEnabled && "delivery"].filter(Boolean).join(" y ");
    console.log(`    Menú público${channels ? ` (${channels})` : ""}: ${BASE_URL}/r/${r.slug}`);
    const first = r.tables?.[0];
    if (first) console.log(`    Pedir desde ${first.label}: ${BASE_URL}/m/${first.token}`);
  }
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}
