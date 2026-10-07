import type { PublicMenu } from "@app/types";
import { headers } from "next/headers";
import { cache } from "react";
import { apiInternalUrl, forwardedForHeader, publicMenuUrl } from "./server-api";

/** Server-only: reads request headers and calls the api directly (not through Caddy). */

export type PublicMenuResult =
  | { status: "ok"; menu: PublicMenu }
  /** Unknown or suspended restaurant (api 404 MENU_NOT_FOUND). */
  | { status: "not_found" }
  /** The api rate-limited this visitor (429): shown as a friendly "try again" page. */
  | { status: "busy" };

const TIMEOUT_MS = 8_000;

/** Slugs are lowercase letters, digits and dashes; anything else cannot exist, so no request is made. */
const POSSIBLE_SLUG = /^[a-z0-9-]{1,60}$/i;

/**
 * Loads the public menu for one request. Not cached across requests on purpose: the visitor's IP is
 * forwarded so the api can rate-limit per visitor, and Next's fetch cache keys include headers (one
 * entry per IP would be useless). React `cache` shares the result between generateMetadata and the page.
 * @throws Error when the api fails or times out (rendered by app/r/[slug]/error.tsx).
 */
export const getPublicMenu = cache(async (slug: string): Promise<PublicMenuResult> => {
  if (!POSSIBLE_SLUG.test(slug)) return { status: "not_found" };
  const incoming = await headers();
  const response = await fetch(publicMenuUrl(apiInternalUrl(), slug), {
    cache: "no-store",
    headers: { Accept: "application/json", ...forwardedForHeader(incoming.get("x-forwarded-for")) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return { status: "not_found" };
  if (response.status === 429) return { status: "busy" };
  if (!response.ok) throw new Error(`public menu for "${slug}": api answered ${response.status}`);
  return { status: "ok", menu: (await response.json()) as PublicMenu };
});
