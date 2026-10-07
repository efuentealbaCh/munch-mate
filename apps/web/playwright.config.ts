import { setDefaultResultOrder } from "node:dns";
import { defineConfig, devices } from "@playwright/test";

// Same IPv6 problem as the browser (see launchOptions below) for the api requests made from Node
// (`request`, `page.request`): prefer 127.0.0.1 when resolving localhost. Runs in every worker.
setDefaultResultOrder("ipv4first");

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
    // Chromium resolves localhost and *.localhost (media.localhost) to ::1 first. Docker Desktop's IPv6
    // port forwarding on Windows drops some concurrent connections (they hang until a 30 s ERR_TIMED_OUT;
    // reproducible with `curl -6`, never with `curl -4`), so the browser is pinned to IPv4.
    launchOptions: { args: ["--host-resolver-rules=MAP localhost 127.0.0.1, MAP *.localhost 127.0.0.1"] },
  },
  // Staff use phones: run the flows on a mobile viewport (Chromium-based device).
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
});
