import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AuthModule } from "../auth/auth.module";
import { MenuModule } from "../menu/menu.module";
import { RestaurantsModule } from "../restaurants/restaurants.module";
import { UsersModule } from "../users/users.module";
import { CountersRepository } from "./counters.repository";
import { OrdersController, PublicOrdersController } from "./orders.controller";
import { OrdersGateway } from "./orders.gateway";
import { OrdersRepository } from "./orders.repository";
import { OrdersService } from "./orders.service";
import { Counter, CounterSchema } from "./schemas/counter.schema";
import { Order, OrderSchema } from "./schemas/order.schema";
import { Table, TableSchema } from "./schemas/table.schema";
import { TablesController } from "./tables.controller";
import { TablesRepository } from "./tables.repository";
import { TablesService } from "./tables.service";

/** Dine-in orders: tables and their QR, ordering, the kitchen board and real-time updates. */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    RestaurantsModule,
    MenuModule,
    MongooseModule.forFeature([
      { name: Table.name, schema: TableSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
  ],
  controllers: [TablesController, OrdersController, PublicOrdersController],
  providers: [OrdersService, TablesService, OrdersGateway, OrdersRepository, TablesRepository, CountersRepository],
})
export class OrdersModule {}
