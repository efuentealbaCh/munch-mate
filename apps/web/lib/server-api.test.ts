import { describe, expect, it } from "vitest";
import { apiInternalUrl, forwardedForHeader, publicMenuUrl, publicTableUrl } from "./server-api";

describe("forwardedForHeader", () => {
  it("forwards the client IP that Caddy set", () => {
    expect(forwardedForHeader("203.0.113.7")).toEqual({ "X-Forwarded-For": "203.0.113.7" });
    expect(forwardedForHeader(" 2001:db8::1 ")).toEqual({ "X-Forwarded-For": "2001:db8::1" });
  });

  it("keeps a proxy chain as is (the api walks it with its trusted proxy list)", () => {
    expect(forwardedForHeader("203.0.113.7, 172.18.0.5")).toEqual({ "X-Forwarded-For": "203.0.113.7, 172.18.0.5" });
  });

  it("sends nothing when the header is missing (pnpm dev) or malformed", () => {
    expect(forwardedForHeader(null)).toEqual({});
    expect(forwardedForHeader(undefined)).toEqual({});
    expect(forwardedForHeader("")).toEqual({});
    expect(forwardedForHeader("unknown")).toEqual({});
    expect(forwardedForHeader("1.2.3.4\r\nX-Evil: 1")).toEqual({});
    expect(forwardedForHeader("1.2.3.4,".repeat(100))).toEqual({});
  });
});

describe("apiInternalUrl", () => {
  it("uses API_INTERNAL_URL (compose) without a trailing slash", () => {
    expect(apiInternalUrl({ API_INTERNAL_URL: "http://api:3000/" })).toBe("http://api:3000");
  });

  it("falls back to the dev api", () => {
    expect(apiInternalUrl({})).toBe("http://localhost:3000");
    expect(apiInternalUrl({ API_INTERNAL_URL: " " })).toBe("http://localhost:3000");
  });
});

describe("publicMenuUrl", () => {
  it("encodes the slug from the URL", () => {
    expect(publicMenuUrl("http://api:3000", "la-pica")).toBe("http://api:3000/api/public/restaurants/la-pica/menu");
    expect(publicMenuUrl("http://api:3000", "../x?y")).toBe("http://api:3000/api/public/restaurants/..%2Fx%3Fy/menu");
  });
});

describe("publicTableUrl", () => {
  it("encodes the table code from the URL", () => {
    expect(publicTableUrl("http://api:3000", "abcd234567")).toBe("http://api:3000/api/public/tables/abcd234567");
    expect(publicTableUrl("http://api:3000", "a/b")).toBe("http://api:3000/api/public/tables/a%2Fb");
  });
});
