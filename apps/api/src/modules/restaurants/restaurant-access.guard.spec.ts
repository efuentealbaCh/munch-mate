import type { RestaurantRole } from "@app/types";
import { type ExecutionContext, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { MembershipsRepository } from "./memberships.repository";
import { RestaurantAccessGuard, type TenantRequest } from "./restaurant-access.guard";
import type { RestaurantsRepository } from "./restaurants.repository";

const RESTAURANT_ID = "665f1f77bcf86cd799439011";

function setup(options: {
  memberRoles?: RestaurantRole[] | null;
  requiredRoles?: RestaurantRole[];
  status?: "active" | "suspended";
  method?: string;
}) {
  const req = {
    method: options.method ?? "GET",
    params: { restaurantId: RESTAURANT_ID },
    user: { id: "user-1", sessionId: "s", emailVerified: true },
  } as unknown as TenantRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  const reflector = { getAllAndOverride: () => options.requiredRoles } as unknown as Reflector;
  const memberships = {
    findOne: async () =>
      options.memberRoles === null
        ? null
        : { restaurantId: RESTAURANT_ID, userId: "user-1", roles: options.memberRoles ?? ["kitchen"], joinedAt: new Date() },
  } as unknown as MembershipsRepository;
  const restaurants = {
    findById: async () => ({ id: RESTAURANT_ID, status: options.status ?? "active" }),
  } as unknown as RestaurantsRepository;
  return { guard: new RestaurantAccessGuard(reflector, memberships, restaurants), context, req };
}

describe("RestaurantAccessGuard", () => {
  it("attaches the tenant built from the membership", async () => {
    const { guard, context, req } = setup({ memberRoles: ["kitchen", "cashier"] });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.tenant).toEqual({ restaurantId: RESTAURANT_ID, roles: ["kitchen", "cashier"], status: "active" });
  });

  it("answers 404 to non-members so other tenants cannot be probed", async () => {
    const { guard, context } = setup({ memberRoles: null });

    await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
  });

  it("requires one of the declared roles", async () => {
    await expect(setup({ memberRoles: ["kitchen"], requiredRoles: ["owner"] }).guard.canActivate(
      setup({ memberRoles: ["kitchen"], requiredRoles: ["owner"] }).context,
    )).rejects.toThrow(ForbiddenException);

    const owner = setup({ memberRoles: ["kitchen", "owner"], requiredRoles: ["owner", "cashier"] });
    await expect(owner.guard.canActivate(owner.context)).resolves.toBe(true);
  });

  it("makes suspended restaurants read-only", async () => {
    const read = setup({ status: "suspended", method: "GET" });
    await expect(read.guard.canActivate(read.context)).resolves.toBe(true);

    const write = setup({ status: "suspended", method: "PATCH", memberRoles: ["owner"] });
    await expect(write.guard.canActivate(write.context)).rejects.toThrow(ForbiddenException);
  });
});
