import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "../../config/env.validation";
import { OriginGuard } from "./origin.guard";

function contextFor(method: string, origin?: string): ExecutionContext {
  const req = { method, headers: origin === undefined ? {} : { origin } };
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("OriginGuard", () => {
  const config = { get: () => "https://munchmate.cl" } as unknown as ConfigService<ApiEnv, true>;
  const guard = new OriginGuard(config);

  it("allows safe methods from any origin", () => {
    expect(guard.canActivate(contextFor("GET", "https://evil.example"))).toBe(true);
  });

  it("allows state-changing requests from APP_URL", () => {
    expect(guard.canActivate(contextFor("POST", "https://munchmate.cl"))).toBe(true);
  });

  it("allows requests without Origin (non-browser clients)", () => {
    expect(guard.canActivate(contextFor("DELETE"))).toBe(true);
  });

  it("rejects state-changing requests from another origin", () => {
    expect(() => guard.canActivate(contextFor("POST", "https://evil.example"))).toThrow(ForbiddenException);
    // Same host on another scheme or port is a different origin.
    expect(() => guard.canActivate(contextFor("PATCH", "http://munchmate.cl"))).toThrow(ForbiddenException);
  });
});
