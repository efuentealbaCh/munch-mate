import { type APIRequestContext, devices, expect, request } from "@playwright/test";
/** Same default as playwright.config.ts (kept separate: test files should not import the config). */
export const BASE_URL = process.env.E2E_BASE_URL ?? "https://localhost";

/** Mailpit HTTP API published by compose.local.yaml. */
const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025";

export const PASSWORD = "contraseña-segura-123";

/** Options for extra browser contexts (they do not inherit the config's `use`). */
export const CONTEXT_OPTIONS = { ...devices["Pixel 7"], baseURL: BASE_URL, ignoreHTTPSErrors: true, locale: "es-CL" };

/** The api rejects state-changing requests without a matching Origin (CSRF); browsers send it, scripts must. */
export const ORIGIN_HEADER = { Origin: new URL(BASE_URL).origin };

/** Short random suffix so every run uses fresh emails and slugs. */
export function runId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${runId()}@example.com`;
}

/** API client with the Origin header, outside any page (for setup). */
export function apiContext(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true, extraHTTPHeaders: ORIGIN_HEADER });
}

interface MailpitSearch {
  messages: Array<{ ID: string; Subject: string }>;
}

/**
 * Waits for an email to `to` containing a link to `path` (e.g. "/verificar-email") and returns that link
 * as a path + query, so the test can open it against BASE_URL whatever host the email used.
 */
export async function waitForEmailLink(to: string, path: string, timeoutMs = 20_000): Promise<string> {
  const pattern = new RegExp(`https?://[^\\s"<>]+${path.replace(/[/-]/g, "\\$&")}\\?token=[A-Za-z0-9_-]+`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = (await (
      await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    ).json()) as MailpitSearch;
    for (const { ID } of search.messages ?? []) {
      const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${ID}`)).json()) as { Text?: string };
      const match = message.Text?.match(pattern);
      if (match) {
        const url = new URL(match[0]);
        return `${url.pathname}${url.search}`;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no email to ${to} with a ${path} link within ${timeoutMs} ms`);
}

/**
 * Registers a user through the api with the given request context (a page's `request` shares its cookies).
 * Registration is rate-limited (5/min per IP), so specs register as few users as possible.
 */
export async function registerViaApi(
  api: APIRequestContext,
  user: { name: string; email: string; password?: string },
): Promise<void> {
  const response = await api.post("/api/auth/register", {
    data: { name: user.name, email: user.email, password: user.password ?? PASSWORD },
    headers: ORIGIN_HEADER,
  });
  expect(response.status(), await response.text()).toBe(201);
}

/** Follows the verification email through the api (for users whose verification is not under test). */
export async function verifyEmailViaApi(api: APIRequestContext, email: string): Promise<void> {
  const link = await waitForEmailLink(email, "/verificar-email");
  const token = new URL(link, BASE_URL).searchParams.get("token");
  const response = await api.post("/api/auth/verify-email", { data: { token }, headers: ORIGIN_HEADER });
  expect(response.status(), await response.text()).toBe(204);
}
