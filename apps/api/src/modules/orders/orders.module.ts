import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AuthModule } from "../auth/auth.module";
import { MapsModule } from "../maps/maps.module";
import { MenuModule } from "../menu/menu.module";
import { RestaurantsModule } from "../restaurants/restaurants.module";
import { UsersModule } from "../users/users.module";
import { CountersRepository } from "./counters.repository";
import { DeliveryZonesController, PublicDeliveryZonesController } from "./delivery-zones.controller";
import { DeliveryZonesRepository } from "./delivery-zones.repository";
import { DeliveryZonesService } from "./delivery-zones.service";
import {
  OrdersController,
  PublicOrdersController,
  ReportsController,
  RiderDeliveriesController,
  RidersController,
} from "./orders.controller";
import { OrdersGateway } from "./orders.gateway";
import { OrdersRepository } from "./orders.repository";
import { OrdersService } from "./orders.service";
import { RiderTrackingService } from "./rider-tracking.service";
import { Counter, CounterSchema } from "./schemas/counter.schema";
import { DeliveryZone, DeliveryZoneSchema } from "./schemas/delivery-zone.schema";
import { Order, OrderSchema } from "./schemas/order.schema";
import { Table, TableSchema } from "./schemas/table.schema";
import { TablesController } from "./tables.controller";
import { TablesRepository } from "./tables.repository";
import { TablesService } from "./tables.service";

/** Orders of every channel: tables and their QR, delivery zones, riders, the board and real-time updates. */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    RestaurantsModule,
    MenuModule,
    MapsModule,
    MongooseModule.forFeature([
      { name: Table.name, schema: TableSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Counter.name, schema: CounterSchema },
      { name: DeliveryZone.name, schema: DeliveryZoneSchema },
    ]),
  ],
  controllers: [
    TablesController,
    OrdersController,
    RidersController,
    RiderDeliveriesController,
    ReportsController,
    PublicOrdersController,
    DeliveryZonesController,
    PublicDeliveryZonesController,
  ],
  providers: [
    OrdersService,
    TablesService,
    DeliveryZonesService,
    OrdersGateway,
    OrdersRepository,
    TablesRepository,
    CountersRepository,
    DeliveryZonesRepository,
    RiderTrackingService,
  ],
})
export class OrdersModule {}
