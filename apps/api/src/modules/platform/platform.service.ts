import type { PlatformRestaurantPage, PlatformRestaurantView, RestaurantStatus } from "@app/types";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { apiError } from "../../common/errors/api-error";
import { MembershipsRepository } from "../restaurants/memberships.repository";
import { RestaurantsRepository } from "../restaurants/restaurants.repository";
import { UsersRepository } from "../users/users.repository";

export const PLATFORM_PAGE_SIZE = 25;

/** Platform-wide administration: every restaurant, suspension. */
@Injectable()
export class PlatformService {
  constructor(
    private readonly restaurants: RestaurantsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly users: UsersRepository,
    @InjectPinoLogger(PlatformService.name) private readonly logger: PinoLogger,
  ) {}

  /** One page of restaurants (newest first) with their owners and team size. */
  async listRestaurants(options: { query?: string; status?: RestaurantStatus; page: number }): Promise<PlatformRestaurantPage> {
    const { items, total } = await this.restaurants.listAll({
      query: options.query?.trim() || undefined,
      status: options.status,
      skip: (options.page - 1) * PLATFORM_PAGE_SIZE,
      limit: PLATFORM_PAGE_SIZE,
    });
    const memberships = await this.memberships.listByRestaurants(items.map((r) => r.id));
    const ownerIds = [...new Set(memberships.filter((m) => m.roles.includes("owner")).map((m) => m.userId))];
    const users = new Map((await this.users.findByIds(ownerIds)).map((u) => [u.id, u]));

    return {
      total,
      items: items.map((restaurant): PlatformRestaurantView => {
        const team = memberships.filter((m) => m.restaurantId === restaurant.id);
        return {
          id: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
          status: restaurant.status,
          acceptingOrders: restaurant.acceptingOrders,
          createdAt: restaurant.createdAt.toISOString(),
          members: team.length,
          owners: team.flatMap((m) => {
            const user = m.roles.includes("owner") ? users.get(m.userId) : undefined;
            return user ? [{ name: user.name, email: user.email }] : [];
          }),
        };
      }),
    };
  }

  /**
   * Suspended restaurants disappear from the public menu, cannot take orders and are read-only for their team.
   * @throws NotFoundException RESTAURANT_NOT_FOUND.
   */
  async setStatus(adminId: string, restaurantId: string, status: RestaurantStatus): Promise<void> {
    const updated = await this.restaurants.setStatus(restaurantId, status);
    if (!updated) throw new NotFoundException(apiError("RESTAURANT_NOT_FOUND", "No encontramos ese restaurante"));
    // Audit trail in the structured logs: who changed what.
    this.logger.info({ adminId, restaurantId, status }, "restaurant status changed by platform admin");
  }
}
