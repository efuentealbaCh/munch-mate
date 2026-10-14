import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { RestaurantsModule } from "../restaurants/restaurants.module";
import { FloorController } from "./floor.controller";
import { FloorPlanService } from "./floor-plan.service";
import { LiveService } from "./live.service";

/**
 * Live floor (phase 9): the floor plan and the live indicators. A module of its own because it spans
 * restaurants (the plan) and orders (tables, orders, table accounts): inside RestaurantsModule it would need
 * the orders repositories, and OrdersModule already depends on RestaurantsModule.
 */
@Module({
  imports: [RestaurantsModule, OrdersModule],
  controllers: [FloorController],
  providers: [FloorPlanService, LiveService],
})
export class FloorModule {}
