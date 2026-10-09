#!/usr/bin/env node
// Generates the VAPID key pair for web push (P-256, base64url as browsers and web-push expect) and writes it
// into .env when VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are empty. Never overwrites existing keys: changing
// them invalidates every push subscription already stored.
//
// Usage (repo root): node infra/scripts/push-keys.mjs   (or: pnpm push:keys)
// On the VPS run it once and keep the keys with the other secrets (SOPS); every environment needs its own.

import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });
// Uncompressed point: 0x04 || X || Y (65 bytes), the "applicationServerKey" browsers take.
const applicationServerKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, "base64url"),
  Buffer.from(pub.y, "base64url"),
]).toString("base64url");
const keys = { VAPID_PUBLIC_KEY: applicationServerKey, VAPID_PRIVATE_KEY: priv.d };

if (!existsSync(".env")) {
  console.error("✗ .env not found: run pnpm env:init first (from the repo root)");
  process.exit(1);
}
let env = readFileSync(".env", "utf8");
const current = (name) => env.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
if (current("VAPID_PUBLIC_KEY") || current("VAPID_PRIVATE_KEY")) {
  console.log("✓ .env already has VAPID keys; nothing changed (rotating them would break existing subscriptions)");
  process.exit(0);
}
for (const [name, value] of Object.entries(keys)) {
  env = new RegExp(`^${name}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`)
    : `${env.replace(/\n?$/, "\n")}${name}=${value}\n`;
}
if (!/^VAPID_SUBJECT=/m.test(env)) env = `${env}VAPID_SUBJECT=mailto:soporte@munchmate.local\n`;
writeFileSync(".env", env);
console.log("✓ VAPID keys written to .env (restart the api and workers, or pnpm stack:up, to use them)");
