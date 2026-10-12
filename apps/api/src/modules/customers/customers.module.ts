import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { UsersModule } from "../users/users.module";
import { CustomerAddressesRepository } from "./customer-addresses.repository";
import { CustomersController } from "./customers.controller";
import { CustomersService } from "./customers.service";
import { CustomerAddress, CustomerAddressSchema } from "./schemas/customer-address.schema";

/** Customer side of an account: profile (name, phone) and saved addresses. The order history is in orders. */
@Module({
  imports: [UsersModule, MongooseModule.forFeature([{ name: CustomerAddress.name, schema: CustomerAddressSchema }])],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerAddressesRepository],
})
export class CustomersModule {}
