import type { TableContext } from "@app/types";
import { headers } from "next/headers";
import { cache } from "react";
import { apiInternalUrl, forwardedForHeader, publicTableUrl } from "./server-api";

/** Server-only: resolves a table QR code for the customer page /m/[token]. */

export type TableContextResult =
  | { status: "ok"; table: TableContext }
  /** Unknown, inactive or regenerated code, or suspended restaurant (api 404 TABLE_NOT_FOUND). */
  | { status: "not_found" }
  /** Rate-limited (429): friendly "try again" page. */
  | { status: "busy" };

const TIMEOUT_MS = 8_000;

/** Table codes are short lowercase alphanumerics; anything else cannot exist, so no request is made. */
const POSSIBLE_TOKEN = /^[a-z0-9]{4,40}$/i;

/**
 * Loads the table context for one request (no data cache, same reasons as getPublicMenu: the visitor's IP
 * is forwarded for the api's per-IP rate limit). React `cache` shares it between metadata and the page.
 * @throws Error when the api fails or times out (rendered by app/m/[token]/error.tsx).
 */
export const getTableContext = cache(async (token: string): Promise<TableContextResult> => {
  if (!POSSIBLE_TOKEN.test(token)) return { status: "not_found" };
  const incoming = await headers();
  const response = await fetch(publicTableUrl(apiInternalUrl(), token), {
    cache: "no-store",
    headers: { Accept: "application/json", ...forwardedForHeader(incoming.get("x-forwarded-for")) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return { status: "not_found" };
  if (response.status === 429) return { status: "busy" };
  if (!response.ok) throw new Error(`table context: api answered ${response.status}`);
  return { status: "ok", table: (await response.json()) as TableContext };
});
