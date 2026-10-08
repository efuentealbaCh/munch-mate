import type { DeliveryZoneView, PublicDeliveryZone } from "@app/types";
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../auth/decorators";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "../restaurants/restaurant-access.guard";
import { DeliveryZoneDto, UpdateDeliveryZoneDto } from "./dto/orders.dto";
import { DeliveryZonesService } from "./delivery-zones.service";

/** Zones are managed by the owner; any member can read them (cashier and riders need the names). */
@Controller("restaurants/:restaurantId/delivery-zones")
@UseGuards(RestaurantAccessGuard)
@RestaurantRoles("owner")
export class DeliveryZonesController {
  constructor(private readonly zones: DeliveryZonesService) {}

  @Get()
  @RestaurantRoles("owner", "cashier", "kitchen", "rider")
  list(@CurrentTenant() tenant: TenantContext): Promise<DeliveryZoneView[]> {
    return this.zones.list(tenant.restaurantId);
  }

  @Post()
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: DeliveryZoneDto): Promise<DeliveryZoneView> {
    return this.zones.create(tenant.restaurantId, dto);
  }

  @Patch(":zoneId")
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param("zoneId") zoneId: string,
    @Body() dto: UpdateDeliveryZoneDto,
  ): Promise<DeliveryZoneView> {
    return this.zones.update(tenant.restaurantId, zoneId, dto);
  }

  @Delete(":zoneId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentTenant() tenant: TenantContext, @Param("zoneId") zoneId: string): Promise<void> {
    await this.zones.delete(tenant.restaurantId, zoneId);
  }
}

/** Checkout: the zones a customer can choose, the restaurant's own commune first. */
@Controller("public/restaurants/:slug/delivery-zones")
export class PublicDeliveryZonesController {
  constructor(private readonly zones: DeliveryZonesService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get()
  list(@Param("slug") slug: string): Promise<PublicDeliveryZone[]> {
    return this.zones.listPublic(slug);
  }
}
