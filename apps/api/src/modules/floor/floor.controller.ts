import type { FloorPlanView, LiveSummary } from "@app/types";
import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "../restaurants/restaurant-access.guard";
import { SaveFloorPlanDto, toSaveFloorPlanInput } from "./dto/floor.dto";
import { FloorPlanService } from "./floor-plan.service";
import { LiveService } from "./live.service";

/**
 * The live view of the restaurant (phase 9). The plan is drawn by the owner and read by the floor and kitchen
 * staff (riders never: they only see their deliveries); the indicators are for the owner and the cashier.
 */
@Controller("restaurants/:restaurantId")
@UseGuards(RestaurantAccessGuard)
export class FloorController {
  constructor(
    private readonly floorPlans: FloorPlanService,
    private readonly live: LiveService,
  ) {}

  @Get("floor-plan")
  @RestaurantRoles("owner", "cashier", "kitchen", "waiter")
  getPlan(@CurrentTenant() tenant: TenantContext): Promise<FloorPlanView> {
    return this.floorPlans.get(tenant.restaurantId);
  }

  /** Replaces the plan and every table position (suspended restaurants: 403 by the guard, like every write). */
  @Put("floor-plan")
  @RestaurantRoles("owner")
  savePlan(@CurrentTenant() tenant: TenantContext, @Body() dto: SaveFloorPlanDto): Promise<FloorPlanView> {
    return this.floorPlans.save(tenant, toSaveFloorPlanInput(dto));
  }

  @Get("live")
  @RestaurantRoles("owner", "cashier")
  summary(@CurrentTenant() tenant: TenantContext): Promise<LiveSummary> {
    return this.live.summary(tenant);
  }
}
