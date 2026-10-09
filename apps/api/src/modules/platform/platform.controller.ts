import type { PlatformRestaurantPage } from "@app/types";
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put, Query, UseGuards } from "@nestjs/common";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators";
import { PlatformRestaurantsQueryDto, RestaurantStatusDto } from "./dto/platform.dto";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformService } from "./platform.service";

/** Platform administration (users with platformRole "admin"; everyone else gets 404). */
@Controller("platform")
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("restaurants")
  list(@Query() query: PlatformRestaurantsQueryDto): Promise<PlatformRestaurantPage> {
    return this.platform.listRestaurants({ query: query.q, status: query.status, page: query.page ?? 1 });
  }

  @Put("restaurants/:restaurantId/status")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setStatus(
    @CurrentUser() user: AuthUser,
    @Param("restaurantId") restaurantId: string,
    @Body() dto: RestaurantStatusDto,
  ): Promise<void> {
    await this.platform.setStatus(user.id, restaurantId, dto.status);
  }
}
