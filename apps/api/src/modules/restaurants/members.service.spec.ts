import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Connection } from "mongoose";
import type { UsersRepository } from "../users/users.repository";
import { MembersService } from "./members.service";
import type { MembershipsRepository } from "./memberships.repository";
import type { TenantContext } from "./restaurant-access.guard";
import type { RestaurantsRepository } from "./restaurants.repository";

const session = { id: "session" };

function setup(options: { ownersAfterChange?: number; found?: boolean } = {}) {
  const memberships = {
    listByRestaurant: jest.fn(async () => [
      { restaurantId: "r1", userId: "u1", roles: ["owner"], joinedAt: new Date("2026-01-01") },
      { restaurantId: "r1", userId: "ghost", roles: ["kitchen"], joinedAt: new Date("2026-01-02") },
    ]),
    setRoles: jest.fn(async () => options.found ?? true),
    remove: jest.fn(async () => options.found ?? true),
    countOwners: jest.fn(async () => options.ownersAfterChange ?? 1),
  };
  const restaurants = { bumpMembershipVersion: jest.fn() };
  const users = {
    findByIds: jest.fn(async () => [{ id: "u1", name: "Ana", email: "ana@example.com" }]),
  };
  const connection = { transaction: (fn: (s: unknown) => Promise<unknown>) => fn(session) };
  const service = new MembersService(
    memberships as unknown as MembershipsRepository,
    restaurants as unknown as RestaurantsRepository,
    users as unknown as UsersRepository,
    connection as unknown as Connection,
  );
  return { service, memberships, restaurants };
}

const ownerTenant: TenantContext = { restaurantId: "r1", roles: ["owner"], status: "active" };
const kitchenTenant: TenantContext = { restaurantId: "r1", roles: ["kitchen"], status: "active" };

describe("MembersService", () => {
  it("lists members with their user data, skipping memberships of deleted users", async () => {
    const { service } = setup();

    await expect(service.list("r1")).resolves.toEqual([
      { userId: "u1", name: "Ana", email: "ana@example.com", roles: ["owner"], joinedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("changes roles inside a transaction that bumps the restaurant's membership version", async () => {
    const { service, memberships, restaurants } = setup();

    await service.updateRoles("r1", "u2", ["cashier"]);

    expect(restaurants.bumpMembershipVersion).toHaveBeenCalledWith("r1", session);
    expect(memberships.setRoles).toHaveBeenCalledWith("r1", "u2", ["cashier"], session);
  });

  it("aborts with LAST_OWNER when no owner would remain", async () => {
    const { service } = setup({ ownersAfterChange: 0 });

    await expect(service.updateRoles("r1", "u1", ["cashier"])).rejects.toThrow(ConflictException);
  });

  it("reports unknown members", async () => {
    const { service } = setup({ found: false });

    await expect(service.updateRoles("r1", "nobody", ["cashier"])).rejects.toThrow(NotFoundException);
  });

  it("lets staff remove only themselves", async () => {
    const { service, memberships } = setup();

    await expect(service.remove(kitchenTenant, "u2", "u1")).rejects.toThrow(ForbiddenException);
    await service.remove(kitchenTenant, "u2", "u2");
    await service.remove(ownerTenant, "u1", "u2");

    expect(memberships.remove).toHaveBeenCalledTimes(2);
  });
});
