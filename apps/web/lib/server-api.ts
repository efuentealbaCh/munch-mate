/**
 * Helpers for server-side requests from Next to the api (Server Components). They bypass Caddy: the web
 * container talks to `api:3000` directly, so anything Caddy would add must be forwarded explicitly.
 * Pure functions (no Next imports) so they can be unit tested.
 */

/** Base URL of the api for server-side fetches: API_INTERNAL_URL (compose: http://api:3000) or the dev api. */
export function apiInternalUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.API_INTERNAL_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

/** IPv4/IPv6 addresses separated by commas; anything else is dropped rather than forwarded. */
const FORWARDED_FOR = /^[0-9A-Fa-f.:]+(\s*,\s*[0-9A-Fa-f.:]+)*$/;
const FORWARDED_FOR_MAX = 256;

/**
 * Header that tells the api who the real visitor is. The api rate-limits the public menu per client IP
 * and trusts proxies on private networks (the web container is one), so without this header every visitor
 * would share the web container's IP and the menu would start answering 429 under modest traffic.
 * @param incoming The `x-forwarded-for` header Next received (set by Caddy; absent in `pnpm dev`).
 * @returns `{ "X-Forwarded-For": … }`, or `{}` when there is nothing valid to forward.
 */
export function forwardedForHeader(incoming: string | null | undefined): Record<string, string> {
  const value = incoming?.trim();
  if (!value || value.length > FORWARDED_FOR_MAX || !FORWARDED_FOR.test(value)) return {};
  return { "X-Forwarded-For": value };
}

/** Public menu endpoint for a slug (the slug is encoded: it comes straight from the URL). */
export function publicMenuUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/api/public/restaurants/${encodeURIComponent(slug)}/menu`;
}
