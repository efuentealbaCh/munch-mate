import type { AdminMenuView, MenuCategoryView, ModifierGroupView, ProductView } from "@app/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ImageUpload, requireImage, type UploadedImageFile } from "../../common/upload/image-upload";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "../restaurants/restaurant-access.guard";
import {
  AvailabilityDto,
  CreateCategoryDto,
  CreateProductDto,
  ModifierGroupDto,
  OrderDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from "./dto/menu.dto";
import { MenuService } from "./menu.service";
import { ModifierGroupsService } from "./modifier-groups.service";
import { ProductsService } from "./products.service";

/** Staff who may mark items as sold out. Every other write is owner-only. */
const AVAILABILITY_ROLES = ["owner", "cashier", "kitchen"] as const;

/**
 * Menu administration. Owner-only by default (class-level role); reading the menu is open to every member
 * and the "agotado" toggles to kitchen and cashier staff.
 */
@Controller("restaurants/:restaurantId/menu")
@UseGuards(RestaurantAccessGuard)
@RestaurantRoles("owner")
export class MenuController {
  constructor(
    private readonly menu: MenuService,
    private readonly products: ProductsService,
    private readonly modifierGroups: ModifierGroupsService,
  ) {}

  @Get()
  @RestaurantRoles() // any member
  get(@CurrentTenant() tenant: TenantContext): Promise<AdminMenuView> {
    return this.menu.getAdminMenu(tenant.restaurantId);
  }

  // ── Categories ────────────────────────────────────────────────────────────

  @Post("categories")
  createCategory(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateCategoryDto): Promise<MenuCategoryView> {
    return this.menu.createCategory(tenant.restaurantId, dto);
  }

  // Declared before "categories/:categoryId" routes for readability; methods differ, so no clash.
  @Put("categories/order")
  reorderCategories(@CurrentTenant() tenant: TenantContext, @Body() dto: OrderDto): Promise<MenuCategoryView[]> {
    return this.menu.reorderCategories(tenant.restaurantId, dto.ids);
  }

  @Patch("categories/:categoryId")
  updateCategory(
    @CurrentTenant() tenant: TenantContext,
    @Param("categoryId") categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<MenuCategoryView> {
    return this.menu.updateCategory(tenant.restaurantId, categoryId, dto);
  }

  @Delete("categories/:categoryId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(@CurrentTenant() tenant: TenantContext, @Param("categoryId") categoryId: string): Promise<void> {
    await this.menu.deleteCategory(tenant.restaurantId, categoryId);
  }

  @Put("categories/:categoryId/products/order")
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorderProducts(
    @CurrentTenant() tenant: TenantContext,
    @Param("categoryId") categoryId: string,
    @Body() dto: OrderDto,
  ): Promise<void> {
    await this.products.reorder(tenant.restaurantId, categoryId, dto.ids);
  }

  // ── Products ──────────────────────────────────────────────────────────────

  @Post("products")
  createProduct(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateProductDto): Promise<ProductView> {
    return this.products.create(tenant.restaurantId, dto);
  }

  @Patch("products/:productId")
  updateProduct(
    @CurrentTenant() tenant: TenantContext,
    @Param("productId") productId: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductView> {
    return this.products.update(tenant.restaurantId, productId, dto);
  }

  @Delete("products/:productId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProduct(@CurrentTenant() tenant: TenantContext, @Param("productId") productId: string): Promise<void> {
    await this.products.delete(tenant.restaurantId, productId);
  }

  @Patch("products/:productId/availability")
  @RestaurantRoles(...AVAILABILITY_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setProductAvailability(
    @CurrentTenant() tenant: TenantContext,
    @Param("productId") productId: string,
    @Body() dto: AvailabilityDto,
  ): Promise<void> {
    await this.products.setAvailability(tenant.restaurantId, productId, dto.available);
  }

  /** Multipart upload, field `file`. Re-encoded to 4:3 WebP in three sizes. */
  @Put("products/:productId/image")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ImageUpload()
  setProductImage(
    @CurrentTenant() tenant: TenantContext,
    @Param("productId") productId: string,
    @UploadedFile() file: UploadedImageFile | undefined,
  ): Promise<ProductView> {
    return this.products.setImage(tenant.restaurantId, productId, requireImage(file));
  }

  @Delete("products/:productId/image")
  removeProductImage(@CurrentTenant() tenant: TenantContext, @Param("productId") productId: string): Promise<ProductView> {
    return this.products.removeImage(tenant.restaurantId, productId);
  }

  // ── Modifier groups (reusable library) ────────────────────────────────────

  @Post("modifier-groups")
  createModifierGroup(@CurrentTenant() tenant: TenantContext, @Body() dto: ModifierGroupDto): Promise<ModifierGroupView> {
    return this.modifierGroups.create(tenant.restaurantId, toGroupInput(dto));
  }

  /** Full replacement: send every option; options keep their id when it is included. */
  @Put("modifier-groups/:groupId")
  replaceModifierGroup(
    @CurrentTenant() tenant: TenantContext,
    @Param("groupId") groupId: string,
    @Body() dto: ModifierGroupDto,
  ): Promise<ModifierGroupView> {
    return this.modifierGroups.replace(tenant.restaurantId, groupId, toGroupInput(dto));
  }

  @Delete("modifier-groups/:groupId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteModifierGroup(@CurrentTenant() tenant: TenantContext, @Param("groupId") groupId: string): Promise<void> {
    await this.modifierGroups.delete(tenant.restaurantId, groupId);
  }

  @Patch("modifier-groups/:groupId/options/:optionId/availability")
  @RestaurantRoles(...AVAILABILITY_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  async setOptionAvailability(
    @CurrentTenant() tenant: TenantContext,
    @Param("groupId") groupId: string,
    @Param("optionId") optionId: string,
    @Body() dto: AvailabilityDto,
  ): Promise<void> {
    await this.modifierGroups.setOptionAvailability(tenant.restaurantId, groupId, optionId, dto.available);
  }
}

function toGroupInput(dto: ModifierGroupDto) {
  return {
    name: dto.name,
    minSelect: dto.minSelect,
    maxSelect: dto.maxSelect,
    options: dto.options.map((option) => ({
      ...(option.id ? { id: option.id } : {}),
      name: option.name,
      priceDelta: option.priceDelta,
      available: option.available ?? true,
    })),
  };
}
