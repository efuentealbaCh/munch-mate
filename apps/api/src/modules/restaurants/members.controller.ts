import type { MemberView } from "@app/types";
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, UseGuards } from "@nestjs/common";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators";
import { UpdateMemberRolesDto } from "./dto/restaurants.dto";
import { MembersService } from "./members.service";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "./restaurant-access.guard";

@Controller("restaurants/:restaurantId/members")
@UseGuards(RestaurantAccessGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** Owners only: the list includes every member's email. */
  @Get()
  @RestaurantRoles("owner")
  list(@CurrentTenant() tenant: TenantContext): Promise<MemberView[]> {
    return this.members.list(tenant.restaurantId);
  }

  @Patch(":userId")
  @RestaurantRoles("owner")
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateRoles(
    @CurrentTenant() tenant: TenantContext,
    @Param("userId") userId: string,
    @Body() dto: UpdateMemberRolesDto,
  ): Promise<void> {
    await this.members.updateRoles(tenant.restaurantId, userId, dto.roles);
  }

  /** Any member may call it on themselves (leave); removing others requires owner (checked in the service). */
  @Delete(":userId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param("userId") userId: string,
  ): Promise<void> {
    await this.members.remove(tenant, user.id, userId);
  }
}
