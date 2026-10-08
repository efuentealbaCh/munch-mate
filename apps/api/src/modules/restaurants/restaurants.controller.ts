import type { RestaurantView, SlugAvailability } from "@app/types";
import { Body, Controller, Delete, Get, Patch, Post, Put, Query, UploadedFile, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ImageUpload, requireImage, type UploadedImageFile } from "../../common/upload/image-upload";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators";
import { VerifiedEmailGuard } from "../auth/verified-email.guard";
import { AcceptingOrdersDto, CreateRestaurantDto, SlugQueryDto, UpdateRestaurantDto } from "./dto/restaurants.dto";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "./restaurant-access.guard";
import { RestaurantsService } from "./restaurants.service";

@Controller("restaurants")
export class RestaurantsController {
  constructor(private readonly restaurants: RestaurantsService) {}

  /** Self-service: any user with a verified email can open a restaurant and becomes its owner. */
  @Post()
  @UseGuards(VerifiedEmailGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRestaurantDto): Promise<RestaurantView> {
    return this.restaurants.create(user.id, dto);
  }

  @Get()
  listMine(@CurrentUser() user: AuthUser): Promise<RestaurantView[]> {
    return this.restaurants.listForUser(user.id);
  }

  // Declared before ":restaurantId" so Express does not treat "slug-availability" as an id.
  @Get("slug-availability")
  checkSlug(@Query() query: SlugQueryDto): Promise<SlugAvailability> {
    return this.restaurants.checkSlug(query.slug);
  }

  @Get(":restaurantId")
  @UseGuards(RestaurantAccessGuard)
  get(@CurrentTenant() tenant: TenantContext): Promise<RestaurantView> {
    return this.restaurants.get(tenant);
  }

  @Patch(":restaurantId")
  @UseGuards(RestaurantAccessGuard)
  @RestaurantRoles("owner")
  update(@CurrentTenant() tenant: TenantContext, @Body() dto: UpdateRestaurantDto): Promise<RestaurantView> {
    return this.restaurants.update(tenant, dto);
  }

  /** Open/closed switch for orders: floor staff can flip it at opening and closing time. */
  @Put(":restaurantId/accepting-orders")
  @UseGuards(RestaurantAccessGuard)
  @RestaurantRoles("owner", "cashier", "kitchen")
  setAcceptingOrders(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: AcceptingOrdersDto,
  ): Promise<RestaurantView> {
    return this.restaurants.setAcceptingOrders(tenant, dto.acceptingOrders);
  }

  /** Multipart upload, field `file`. Re-encoded to square WebP (see image-processor). */
  @Put(":restaurantId/logo")
  @UseGuards(RestaurantAccessGuard)
  @RestaurantRoles("owner")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ImageUpload()
  setLogo(
    @CurrentTenant() tenant: TenantContext,
    @UploadedFile() file: UploadedImageFile | undefined,
  ): Promise<RestaurantView> {
    return this.restaurants.setLogo(tenant, requireImage(file));
  }

  @Delete(":restaurantId/logo")
  @UseGuards(RestaurantAccessGuard)
  @RestaurantRoles("owner")
  removeLogo(@CurrentTenant() tenant: TenantContext): Promise<RestaurantView> {
    return this.restaurants.removeLogo(tenant);
  }
}
