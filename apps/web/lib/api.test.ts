import { describe, expect, it, vi } from "vitest";
import { ApiError, NETWORK_ERROR, createApiClient, parseApiError } from "./api";
import { RATE_LIMITED_MESSAGE, errorMessage } from "./errors";

const PROFILE = { id: "u1", email: "a@b.cl", name: "Ana", emailVerified: true };

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const unauthenticated = () => json(401, { statusCode: 401, code: "UNAUTHENTICATED", message: "Debes iniciar sesión" });
const invalidSession = () =>
  json(401, { statusCode: 401, code: "INVALID_SESSION", message: "Tu sesión expiró, vuelve a ingresar" });

/** Fake fetch routed by "METHOD path"; each route returns queued responses in order. */
function fakeFetch(routes: Record<string, Array<() => Response | Promise<Response>>>) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    calls.push(key);
    const next = routes[key]?.shift();
    if (!next) throw new Error(`unexpected call ${key}`);
    return next();
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const noSleep = () => Promise.resolve();

describe("parseApiError", () => {
  it("keeps code, message, details and meta", () => {
    const error = parseApiError(409, {
      statusCode: 409,
      code: "SLUG_TAKEN",
      message: "Esa dirección ya está en uso",
      meta: { suggestion: "pica-2" },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "SLUG_TAKEN", message: "Esa dirección ya está en uso" });
    expect(error.meta).toEqual({ suggestion: "pica-2" });

    const validation = parseApiError(400, {
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Hay campos con errores",
      details: ["email no es un correo válido"],
    });
    expect(validation.details).toEqual(["email no es un correo válido"]);
  });

  it("falls back to a generic error for non-api bodies", () => {
    const error = parseApiError(502, null);
    expect(error.code).toBe("HTTP_502");
    expect(error.message).toMatch(/error inesperado/);
  });
});

describe("errorMessage", () => {
  it("uses friendly wording for rate limits and hides internal codes", () => {
    expect(errorMessage(new ApiError(429, "RATE_LIMITED", "ThrottlerException: Too Many Requests"))).toBe(
      RATE_LIMITED_MESSAGE,
    );
    expect(errorMessage(new ApiError(403, "ORIGIN_NOT_ALLOWED", "Origen no permitido"))).toMatch(/error inesperado/);
    expect(errorMessage(new ApiError(409, "EMAIL_TAKEN", "Ese correo ya está registrado"))).toBe(
      "Ese correo ya está registrado",
    );
    expect(errorMessage(new Error("boom"))).toMatch(/error inesperado/);
  });
});

describe("api client", () => {
  it("sends JSON with same-origin credentials and returns the body", async () => {
    const { fetch } = fakeFetch({ "POST /api/auth/login": [() => json(200, PROFILE)] });
    const client = createApiClient({ fetch, sleep: noSleep });

    await expect(client.request("/auth/login", { method: "POST", body: { email: "a@b.cl" } })).resolves.toEqual(PROFILE);
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.credentials).toBe("same-origin");
    expect(init?.body).toBe(JSON.stringify({ email: "a@b.cl" }));
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns undefined for 204", async () => {
    const { fetch } = fakeFetch({ "POST /api/auth/logout": [() => new Response(null, { status: 204 })] });
    await expect(createApiClient({ fetch }).request("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("throws ApiError with the api's code", async () => {
    const { fetch } = fakeFetch({
      "POST /api/auth/login": [
        () => json(401, { statusCode: 401, code: "INVALID_CREDENTIALS", message: "Correo o contraseña incorrectos" }),
      ],
    });
    const client = createApiClient({ fetch, sleep: noSleep });
    await expect(client.request("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
    });
  });

  it("maps network failures to NETWORK_ERROR", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    await expect(createApiClient({ fetch }).request("/restaurants")).rejects.toMatchObject({ code: NETWORK_ERROR });
  });

  it("refreshes once on UNAUTHENTICATED and retries the request", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /api/restaurants": [unauthenticated, () => json(200, [])],
      "POST /api/auth/refresh": [() => json(200, PROFILE)],
    });
    const client = createApiClient({ fetch, sleep: noSleep });

    await expect(client.request("/restaurants")).resolves.toEqual([]);
    expect(calls).toEqual(["GET /api/restaurants", "POST /api/auth/refresh", "GET /api/restaurants"]);
  });

  it("shares a single refresh between concurrent 401s", async () => {
    let releaseRefresh: () => void = () => {};
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const { fetch, calls } = fakeFetch({
      "GET /api/restaurants": [unauthenticated, () => json(200, [])],
      "GET /api/auth/me": [unauthenticated, () => json(200, PROFILE)],
      "POST /api/auth/refresh": [
        async () => {
          await refreshGate;
          return json(200, PROFILE);
        },
      ],
    });
    const client = createApiClient({ fetch, sleep: noSleep });

    const both = Promise.all([client.request("/restaurants"), client.request("/auth/me")]);
    // Let both requests receive their 401 before the refresh answers.
    await vi.waitFor(() => expect(calls.filter((c) => c === "POST /api/auth/refresh")).toHaveLength(1));
    releaseRefresh();

    await expect(both).resolves.toEqual([[], PROFILE]);
    expect(calls.filter((c) => c === "POST /api/auth/refresh")).toHaveLength(1);
  });

  it("retries a failed refresh once after a short delay (two tabs refreshing at once)", async () => {
    const sleep = vi.fn(noSleep);
    const { fetch, calls } = fakeFetch({
      "GET /api/restaurants": [unauthenticated, () => json(200, [])],
      "POST /api/auth/refresh": [invalidSession, () => json(200, PROFILE)],
    });
    const client = createApiClient({ fetch, sleep, refreshRetryDelayMs: 300 });

    await expect(client.request("/restaurants")).resolves.toEqual([]);
    expect(sleep).toHaveBeenCalledWith(300);
    expect(calls.filter((c) => c === "POST /api/auth/refresh")).toHaveLength(2);
  });

  it("treats a refresh that fails twice as logged out and notifies listeners", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /api/restaurants": [unauthenticated],
      "POST /api/auth/refresh": [invalidSession, invalidSession],
    });
    const client = createApiClient({ fetch, sleep: noSleep });
    const expired = vi.fn();
    client.onSessionExpired(expired);

    await expect(client.request("/restaurants")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["GET /api/restaurants", "POST /api/auth/refresh", "POST /api/auth/refresh"]);
  });

  it("never refreshes for auth endpoints or for other 401 codes", async () => {
    const { fetch, calls } = fakeFetch({
      "POST /api/auth/login": [unauthenticated],
      "GET /api/restaurants": [invalidSession],
    });
    const client = createApiClient({ fetch, sleep: noSleep });

    await expect(client.request("/auth/login", { method: "POST", body: {} })).rejects.toBeInstanceOf(ApiError);
    await expect(client.request("/restaurants")).rejects.toMatchObject({ code: "INVALID_SESSION" });
    expect(calls).toEqual(["POST /api/auth/login", "GET /api/restaurants"]);
  });

  it("refreshSession returns null when logged out and the profile otherwise", async () => {
    const { fetch } = fakeFetch({
      "POST /api/auth/refresh": [invalidSession, invalidSession, () => json(200, PROFILE)],
    });
    const client = createApiClient({ fetch, sleep: noSleep });
    await expect(client.refreshSession()).resolves.toBeNull();
    await expect(client.refreshSession()).resolves.toEqual(PROFILE);
  });

  it("sends FormData as multipart (no JSON Content-Type) and resends it after a refresh", async () => {
    const bodies: unknown[] = [];
    const headers: Array<Record<string, string>> = [];
    const responses = [unauthenticated, () => json(200, { id: "p1" })];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/refresh") return json(200, PROFILE);
      bodies.push(init?.body);
      headers.push(init?.headers as Record<string, string>);
      const next = responses.shift();
      if (!next) throw new Error("unexpected call");
      return next();
    }) as unknown as typeof globalThis.fetch;
    const client = createApiClient({ fetch, sleep: noSleep });
    const form = new FormData();
    form.append("file", new Blob(["x"], { type: "image/jpeg" }), "foto.jpg");

    await expect(client.request("/restaurants/r1/menu/products/p1/image", { method: "PUT", body: form })).resolves.toEqual({
      id: "p1",
    });
    expect(bodies).toEqual([form, form]);
    for (const sent of headers) expect(sent).toEqual({ Accept: "application/json" });
  });
});
