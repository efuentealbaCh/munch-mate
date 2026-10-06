import type { MemberView, RestaurantRole } from "@app/types";
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { ClientSession, Connection } from "mongoose";
import { apiError } from "../../common/errors/api-error";
import { UsersRepository } from "../users/users.repository";
import { MembershipsRepository } from "./memberships.repository";
import type { TenantContext } from "./restaurant-access.guard";
import { RestaurantsRepository } from "./restaurants.repository";

const memberNotFound = () => new NotFoundException(apiError("MEMBER_NOT_FOUND", "Esa persona no es parte del equipo"));
const lastOwner = () =>
  new ConflictException(apiError("LAST_OWNER", "El restaurante debe tener al menos un dueño"));

@Injectable()
export class MembersService {
  constructor(
    private readonly memberships: MembershipsRepository,
    private readonly restaurants: RestaurantsRepository,
    private readonly users: UsersRepository,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async list(restaurantId: string): Promise<MemberView[]> {
    const memberships = await this.memberships.listByRestaurant(restaurantId);
    const users = new Map((await this.users.findByIds(memberships.map((m) => m.userId))).map((u) => [u.id, u]));
    return memberships.flatMap((m) => {
      const user = users.get(m.userId);
      return user
        ? [{ userId: m.userId, name: user.name, email: user.email, roles: m.roles, joinedAt: m.joinedAt.toISOString() }]
        : [];
    });
  }

  /** @throws NotFoundException MEMBER_NOT_FOUND, ConflictException LAST_OWNER. */
  async updateRoles(restaurantId: string, userId: string, roles: RestaurantRole[]): Promise<void> {
    await this.changeOwnership(restaurantId, async (session) => {
      if (!(await this.memberships.setRoles(restaurantId, userId, roles, session))) throw memberNotFound();
    });
  }

  /**
   * Owners can remove anyone; any member can remove themselves (leave the restaurant).
   * @throws ForbiddenException FORBIDDEN_ROLE, NotFoundException MEMBER_NOT_FOUND, ConflictException LAST_OWNER.
   */
  async remove(tenant: TenantContext, actorId: string, userId: string): Promise<void> {
    if (actorId !== userId && !tenant.roles.includes("owner")) {
      throw new ForbiddenException(apiError("FORBIDDEN_ROLE", "Tu rol no permite esta acción"));
    }
    await this.changeOwnership(tenant.restaurantId, async (session) => {
      if (!(await this.memberships.remove(tenant.restaurantId, userId, session))) throw memberNotFound();
    });
  }

  /**
   * Runs a membership change in a transaction that aborts if no owner would remain.
   * Bumping the restaurant's membershipVersion makes concurrent changes conflict, so two owners demoting
   * each other at the same time cannot both succeed (MongoDB snapshot isolation alone allows that).
   */
  private async changeOwnership(restaurantId: string, change: (session: ClientSession) => Promise<void>) {
    await this.connection.transaction(async (session) => {
      await this.restaurants.bumpMembershipVersion(restaurantId, session);
      await change(session);
      if ((await this.memberships.countOwners(restaurantId, session)) === 0) throw lastOwner();
    });
  }
}
