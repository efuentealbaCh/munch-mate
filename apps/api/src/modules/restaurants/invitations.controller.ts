import type { InvitationPreview, InvitationView, RestaurantView } from "@app/types";
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser, Public } from "../auth/decorators";
import { TokenDto } from "../auth/dto/auth.dto";
import { InviteDto } from "./dto/restaurants.dto";
import { InvitationsService } from "./invitations.service";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "./restaurant-access.guard";

/** Owner-side management of a restaurant's invitations. */
@Controller("restaurants/:restaurantId/invitations")
@UseGuards(RestaurantAccessGuard)
@RestaurantRoles("owner")
export class RestaurantInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  invite(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Body() dto: InviteDto,
  ): Promise<InvitationView> {
    return this.invitations.invite(tenant.restaurantId, user.id, dto);
  }

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<InvitationView[]> {
    return this.invitations.listPending(tenant.restaurantId);
  }

  @Delete(":invitationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@CurrentTenant() tenant: TenantContext, @Param("invitationId") id: string): Promise<void> {
    await this.invitations.revoke(tenant.restaurantId, id);
  }
}

/**
 * Invitee-side endpoints. The token travels in the body, never in the URL, so it does not end up in
 * access logs.
 */
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("preview")
  @HttpCode(HttpStatus.OK)
  preview(@Body() dto: TokenDto): Promise<InvitationPreview> {
    return this.invitations.preview(dto.token);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("accept")
  @HttpCode(HttpStatus.OK)
  accept(@CurrentUser() user: AuthUser, @Body() dto: TokenDto): Promise<RestaurantView> {
    return this.invitations.accept(dto.token, user.id);
  }
}
