import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E against the local production stack (`pnpm stack:up`): real images behind Caddy with its local
 * CA, emails read from Mailpit. Not part of `pnpm test:e2e` (that one is the api's Testcontainers suite).
 * Serial on purpose: the api rate-limits registration to 5/min per IP.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "https://localhost";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    locale: "es-CL",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Staff use phones: run the flows on a mobile viewport (Chromium-based device).
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
});
