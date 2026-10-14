import type { FloorPlanView, SaveFloorPlanInput, TableLayout } from "@app/types";
import { FLOOR_PLAN_MESSAGES, floorPlanProblem } from "@app/utils";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { apiError } from "../../common/errors/api-error";
import { TablesRepository } from "../orders/tables.repository";
import { RealtimeService } from "../realtime/realtime.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import { RestaurantsRepository } from "../restaurants/restaurants.repository";

const notFound = () => new NotFoundException(apiError("RESTAURANT_NOT_FOUND", "Restaurante no encontrado"));

/**
 * The floor plan of the live view (phase 9): the restaurant's grid with kitchen, pickup counter and delivery
 * door (`restaurants.floorPlan`) plus where each table sits (`tables.layout`). The owner edits it; the staff
 * read it.
 */
@Injectable()
export class FloorPlanService {
  constructor(
    private readonly restaurants: RestaurantsRepository,
    private readonly tables: TablesRepository,
    @InjectConnection() private readonly connection: Connection,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * The plan and every table of the restaurant (placed or not, active or not, in natural label order): the
   * editor lists the unplaced ones; the live view draws only active tables with a layout.
   * @throws NotFoundException RESTAURANT_NOT_FOUND.
   */
  async get(restaurantId: string): Promise<FloorPlanView> {
    const [restaurant, tables] = await Promise.all([
      this.restaurants.findById(restaurantId),
      this.tables.list(restaurantId),
    ]);
    if (!restaurant) throw notFound();
    return {
      plan: restaurant.floorPlan,
      // Without a plan no layout is meaningful (they are cleared together; this also hides any leftover).
      tables: tables.map((t) => ({
        id: t.id,
        label: t.label,
        active: t.active,
        layout: restaurant.floorPlan ? t.layout : null,
      })),
    };
  }

  /**
   * Saves the whole layout: the plan and the position of every table, in one transaction (the live view never
   * sees a plan with tables of the previous one). Tables not listed, or listed with a null layout, are taken
   * off the plan. `plan: null` deletes the plan and every layout (the tables listed are then ignored). Last
   * write wins between two owners editing at once. Tells the staff screens with `floor-plan.updated`.
   * @throws BadRequestException UNKNOWN_TABLE (`meta.tableId`: not a table of this restaurant),
   *   INVALID_FLOOR_PLAN (`meta.problem`: a FloorPlanProblem); NotFoundException RESTAURANT_NOT_FOUND.
   */
  async save(tenant: TenantContext, input: SaveFloorPlanInput): Promise<FloorPlanView> {
    const restaurantId = tenant.restaurantId;
    const entries = input.plan === null ? [] : input.tables;

    if (entries.length > 0) {
      const known = new Set((await this.tables.list(restaurantId)).map((t) => t.id));
      const unknown = entries.find((entry) => !known.has(entry.tableId));
      if (unknown) {
        throw new BadRequestException(
          apiError("UNKNOWN_TABLE", "Una de las mesas del plano ya no existe; recarga la página", {
            tableId: unknown.tableId,
          }),
        );
      }
    }

    const problem = floorPlanProblem(input.plan, entries);
    if (problem) {
      throw new BadRequestException(apiError("INVALID_FLOOR_PLAN", FLOOR_PLAN_MESSAGES[problem], { problem }));
    }

    // A layout sent without rotation is horizontal: stored as 0 so the views always carry it.
    const placed = entries.flatMap((entry): { tableId: string; layout: TableLayout }[] =>
      entry.layout ? [{ tableId: entry.tableId, layout: { ...entry.layout, rotation: entry.layout.rotation ?? 0 } }] : [],
    );
    await this.connection.transaction(async (session) => {
      if (!(await this.restaurants.setFloorPlan(restaurantId, input.plan, session))) throw notFound();
      await this.tables.replaceLayouts(restaurantId, placed, session);
    });

    const view = await this.get(restaurantId);
    this.realtime.toRestaurant(restaurantId).emit("floor-plan.updated", view);
    return view;
  }
}
