import { setDefaultResultOrder } from "node:dns";
import { defineConfig, devices } from "@playwright/test";

setDefaultResultOrder("ipv4first");

/**
 * Guided walkthroughs that take the screenshots of the test guide (`docs/capturas/`). Not part of
 * `pnpm test:web`: they run against the demo data (`pnpm seed:demo`) and leave orders behind on purpose.
 * Run with `pnpm capturas:delivery` (needs `pnpm stack:up`, `pnpm seed:demo` and `pnpm maps:init`).
 */
export default defineConfig({
  testDir: "./guide",
  testMatch: "**/*.guide.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://localhost",
    ignoreHTTPSErrors: true,
    locale: "es-CL",
    timezoneId: "America/Santiago",
    actionTimeout: 20_000,
    trace: "retain-on-failure",
    // Same IPv4 pinning as playwright.config.ts (Docker Desktop on Windows drops IPv6 connections).
    launchOptions: { args: ["--host-resolver-rules=MAP localhost 127.0.0.1, MAP *.localhost 127.0.0.1"] },
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
});
