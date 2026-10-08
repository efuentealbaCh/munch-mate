/** Access token lifetime. Short, because a stolen access token cannot be revoked before it expires. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Refresh token lifetime; every refresh issues a new one, so an active user stays logged in indefinitely. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A rotated refresh token presented again within this window is treated as a concurrent refresh
 * (two tabs at once), not as theft: the request fails but the session family is not revoked.
 */
export const ROTATION_GRACE_MS = 10_000;

/** Lifetime of emailed one-time links (verification, password reset). */
export const ONE_TIME_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export const ACCESS_COOKIE = "mm_at";
export const REFRESH_COOKIE = "mm_rt";
/** The refresh cookie is only sent to the auth endpoints, never to the rest of the api. */
export const REFRESH_COOKIE_PATH = "/api/auth";
