import type { LiveSummary } from "@app/types";
import { Injectable, NotFoundException } from "@nestjs/common";
import { apiError } from "../../common/errors/api-error";
import { addDays, summarizeLive } from "../orders/live-summary";
import { businessDate } from "../orders/order-tokens";
import { OrdersRepository } from "../orders/orders.repository";
import { TableSessionsRepository } from "../orders/table-sessions.repository";
import { TablesRepository } from "../orders/tables.repository";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import { RestaurantsRepository } from "../restaurants/restaurants.repository";

/** The indicators of the live view (phase 9): loads the tenant's data and hands it to `summarizeLive`. */
@Injectable()
export class LiveService {
  constructor(
    private readonly restaurants: RestaurantsRepository,
    private readonly orders: OrdersRepository,
    private readonly tables: TablesRepository,
    private readonly tableSessions: TableSessionsRepository,
  ) {}

  /**
   * Sales, orders in progress, kitchen time and tables right now. Positioned tables count only while the
   * restaurant has a plan (layouts are meaningless without one) and only active tables (the view skips the
   * inactive ones); table accounts count whether or not their table is on the plan.
   * @throws NotFoundException RESTAURANT_NOT_FOUND.
   */
  async summary(tenant: TenantContext, now = new Date()): Promise<LiveSummary> {
    const restaurantId = tenant.restaurantId;
    const restaurant = await this.restaurants.findById(restaurantId);
    if (!restaurant) throw new NotFoundException(apiError("RESTAURANT_NOT_FOUND", "Restaurante no encontrado"));

    const today = businessDate(now, restaurant.timezone);
    const [todayOrders, lastWeek, active, tables, openSessions] = await Promise.all([
      this.orders.listByBusinessDate(restaurantId, today),
      this.orders.listByBusinessDate(restaurantId, addDays(today, -7)),
      this.orders.listActive(restaurantId),
      this.tables.list(restaurantId),
      this.tableSessions.listOpen(restaurantId),
    ]);
    const ordersBySession = await this.orders.listByTableSessions(
      restaurantId,
      openSessions.map((s) => s.id),
    );

    return summarizeLive({
      now,
      timeZone: restaurant.timezone,
      currency: restaurant.currency,
      kitchenTargetMinutes: restaurant.kitchenTargetMinutes,
      today: todayOrders,
      lastWeek,
      active,
      positionedTables: restaurant.floorPlan ? tables.filter((t) => t.active && t.layout !== null).length : 0,
      openAccounts: openSessions.map((session) => ({
        session,
        orders: ordersBySession.get(session.id)?.length ?? 0,
      })),
    });
  }
}
