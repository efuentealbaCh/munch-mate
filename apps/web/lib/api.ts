import type { ApiErrorBody, UserProfile } from "@app/types";

/** Code used for errors that never reached the api (offline, DNS, connection reset). */
export const NETWORK_ERROR = "NETWORK_ERROR";

/** Error thrown by every api call. `code` is stable (branch on it); `message` is user-facing Spanish. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[] | undefined;
  readonly meta: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, details?: string[], meta?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.meta = meta;
  }
}

const GENERIC_MESSAGE = "Ocurrió un error inesperado. Intenta de nuevo.";

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

/**
 * Turns an error response into an {@link ApiError}. Bodies that are not an `ApiErrorBody`
 * (e.g. an HTML 502 from the proxy) become a generic `HTTP_<status>` error.
 * @param status HTTP status of the response.
 * @param body Parsed JSON body, or null when it was not JSON.
 */
export function parseApiError(status: number, body: unknown): ApiError {
  if (!isApiErrorBody(body)) return new ApiError(status, `HTTP_${status}`, GENERIC_MESSAGE);
  const details = Array.isArray(body.details) ? body.details.map(String) : undefined;
  const meta = body.meta && typeof body.meta === "object" ? body.meta : undefined;
  return new ApiError(status, body.code, body.message, details, meta);
}

/** Auth endpoints must never trigger the refresh-and-retry logic (it would loop or mask real errors). */
const NO_REFRESH_PATHS = new Set(["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"]);

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /**
   * Serialized as JSON, except `FormData`, which is sent as multipart/form-data (file uploads). FormData can
   * be sent twice, so the refresh-and-retry logic works for uploads too.
   */
  body?: unknown;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Defaults to "/api" (same origin: Caddy in production, Next rewrites in dev). */
  baseUrl?: string;
  /** Wait before retrying a failed refresh (two tabs may have rotated the token at the same moment). */
  refreshRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface ApiClient {
  /**
   * Calls the api and returns the parsed JSON (undefined for 204).
   * On 401 UNAUTHENTICATED refreshes the session once (shared between concurrent calls) and retries.
   * @throws ApiError on any non-2xx response or network failure.
   */
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  /**
   * Same as {@link request} (refresh on 401, ApiError on non-2xx) but returns the raw successful Response,
   * for bodies that are not JSON (PDF downloads) or when the status matters (202 vs 200).
   */
  requestResponse(path: string, options?: RequestOptions): Promise<Response>;
  /**
   * Rotates the session cookies. Concurrent callers share one request.
   * @returns The fresh profile, or null when there is no valid session (logged out).
   * @throws ApiError only for network/unexpected failures.
   */
  refreshSession(): Promise<UserProfile | null>;
  /** Called when a refresh proves the session is gone. @returns An unsubscribe function. */
  onSessionExpired(listener: () => void): () => void;
}

/**
 * Creates the api client. A factory (instead of module-level state only) so tests can inject a fake fetch.
 * @param options See {@link ApiClientOptions}.
 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const doFetch = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const baseUrl = options.baseUrl ?? "/api";
  const retryDelay = options.refreshRetryDelayMs ?? 300;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const expiredListeners = new Set<() => void>();
  let refreshing: Promise<UserProfile | null> | null = null;

  async function send(path: string, { method = "GET", body, signal }: RequestOptions): Promise<Response> {
    // No Content-Type for multipart: fetch sets it with the boundary.
    const multipart = typeof FormData !== "undefined" && body instanceof FormData;
    const json = body !== undefined && !multipart;
    try {
      return await doFetch(`${baseUrl}${path}`, {
        method,
        credentials: "same-origin",
        headers: json ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
        body: multipart ? (body as FormData) : json ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, NETWORK_ERROR, "No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.");
    }
  }

  async function readBody(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  async function toError(response: Response): Promise<ApiError> {
    return parseApiError(response.status, await readBody(response));
  }

  async function attemptRefresh(): Promise<UserProfile | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await send("/auth/refresh", { method: "POST" });
      if (response.ok) return (await readBody(response)) as UserProfile;
      if (response.status !== 401) throw await toError(response);
      // A 401 can be transient: another tab rotated the refresh token a moment ago and its new cookie
      // may not have been stored yet. Retry once before declaring the session dead.
      if (attempt === 0) await sleep(retryDelay);
    }
    return null;
  }

  function refreshSession(): Promise<UserProfile | null> {
    refreshing ??= attemptRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function requestResponse(path: string, options: RequestOptions = {}): Promise<Response> {
    let response = await send(path, options);

    if (response.status === 401 && !NO_REFRESH_PATHS.has(path)) {
      const error = await toError(response);
      if (error.code !== "UNAUTHENTICATED") throw error;
      const profile = await refreshSession();
      if (!profile) {
        for (const listener of expiredListeners) listener();
        throw error;
      }
      response = await send(path, options);
    }

    if (!response.ok) throw await toError(response);
    return response;
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return (await readBody(await requestResponse(path, options))) as T;
  }

  return {
    request,
    requestResponse,
    refreshSession,
    onSessionExpired(listener) {
      expiredListeners.add(listener);
      return () => expiredListeners.delete(listener);
    },
  };
}

/** Shared client used by the app. */
export const api = createApiClient();
