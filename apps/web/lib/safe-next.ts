/** Where users land after login/registration when no (valid) `next` was given. */
export const DEFAULT_AFTER_LOGIN = "/admin";

/**
 * Validates a `next` redirect target taken from the URL (open-redirect protection).
 * Only same-origin relative paths are accepted: they must start with "/" and not with "//" or "/\"
 * (browsers treat both as protocol-relative URLs to another host). Control characters are rejected
 * because browsers strip them, which could turn "/\t/evil.com" into "//evil.com".
 * @param raw Value of the `next` query parameter (may be null/undefined).
 * @param fallback Path returned when `raw` is missing or unsafe.
 * @returns A safe relative path.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = DEFAULT_AFTER_LOGIN): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}

/**
 * Builds a link to an auth page that carries the `next` target along (e.g. "Crear cuenta" from the
 * login page keeps the invitation the user came from).
 * @param path Auth page path, e.g. "/ingresar".
 * @param params Query parameters; empty/undefined values are skipped.
 */
export function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}
