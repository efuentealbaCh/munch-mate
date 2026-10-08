import { Module } from "@nestjs/common";
import { RestaurantsModule } from "../restaurants/restaurants.module";
import { UsersModule } from "../users/users.module";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";

/** Platform admin: list and suspend restaurants. The first admin is set with `pnpm platform:admin <email>`. */
@Module({
  imports: [UsersModule, RestaurantsModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAdminGuard],
})
export class PlatformModule {}
