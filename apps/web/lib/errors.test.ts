import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { errorMessage, GENERIC_ERROR_MESSAGE, RATE_LIMITED_MESSAGE } from "./errors";

describe("errorMessage", () => {
  it("shows the api's own message for a 429 with its own code (too many pickup orders)", () => {
    const message = "Ya tienes varios pedidos en curso en este local. Espera a retirarlos antes de hacer otro.";
    expect(errorMessage(new ApiError(429, "TOO_MANY_ACTIVE_ORDERS", message))).toBe(message);
  });

  it("uses the generic wording for the throttler's 429 and for unknown failures", () => {
    expect(errorMessage(new ApiError(429, "RATE_LIMITED", "ThrottlerException: Too Many Requests"))).toBe(RATE_LIMITED_MESSAGE);
    expect(errorMessage(new Error("boom"))).toBe(GENERIC_ERROR_MESSAGE);
  });
});
