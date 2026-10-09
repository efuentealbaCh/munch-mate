import type { SavedAddressView, UserProfile } from "@app/types";
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put } from "@nestjs/common";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators";
import { CustomersService } from "./customers.service";
import { ProfileDto, SavedAddressDto } from "./dto/customers.dto";

/** The signed-in person's own data for ordering. Every route acts only on the caller's account. */
@Controller("me")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Patch()
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: ProfileDto): Promise<UserProfile> {
    return this.customers.updateProfile(user.id, dto);
  }

  @Get("addresses")
  listAddresses(@CurrentUser() user: AuthUser): Promise<SavedAddressView[]> {
    return this.customers.listAddresses(user.id);
  }

  @Post("addresses")
  createAddress(@CurrentUser() user: AuthUser, @Body() dto: SavedAddressDto): Promise<SavedAddressView> {
    return this.customers.createAddress(user.id, dto);
  }

  @Put("addresses/:addressId")
  updateAddress(
    @CurrentUser() user: AuthUser,
    @Param("addressId") addressId: string,
    @Body() dto: SavedAddressDto,
  ): Promise<SavedAddressView> {
    return this.customers.updateAddress(user.id, addressId, dto);
  }

  @Delete("addresses/:addressId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAddress(@CurrentUser() user: AuthUser, @Param("addressId") addressId: string): Promise<void> {
    await this.customers.deleteAddress(user.id, addressId);
  }
}
