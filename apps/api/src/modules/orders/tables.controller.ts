import type { TableView } from "@app/types";
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
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "../restaurants/restaurant-access.guard";
import { TableDto, UpdateTableDto } from "./dto/orders.dto";
import { TablesService } from "./tables.service";

/** Table management is owner-only; floor staff can see the list (to know table labels). */
@Controller("restaurants/:restaurantId/tables")
@UseGuards(RestaurantAccessGuard)
@RestaurantRoles("owner")
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @RestaurantRoles("owner", "cashier", "kitchen")
  list(@CurrentTenant() tenant: TenantContext): Promise<TableView[]> {
    return this.tables.list(tenant.restaurantId);
  }

  @Post()
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: TableDto): Promise<TableView> {
    return this.tables.create(tenant.restaurantId, dto.label);
  }

  /** Starts generating the printable QR sheet in the workers. Poll GET qr-sheet/:jobId or wait for `qr-sheet.ready`. */
  @Post("qr-sheet")
  @HttpCode(HttpStatus.ACCEPTED)
  requestQrSheet(@CurrentTenant() tenant: TenantContext): Promise<{ jobId: string }> {
    return this.tables.requestQrSheet(tenant);
  }

  /** 202 `{ status: "pending" }` while generating; the PDF itself once ready. */
  @Get("qr-sheet/:jobId")
  async getQrSheet(
    @CurrentTenant() tenant: TenantContext,
    @Param("jobId") jobId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | { status: "pending" }> {
    const result = await this.tables.getQrSheet(tenant, jobId);
    if (result.status === "pending") {
      res.status(HttpStatus.ACCEPTED);
      return { status: "pending" };
    }
    return new StreamableFile(result.pdf, {
      type: "application/pdf",
      disposition: 'attachment; filename="codigos-qr-mesas.pdf"',
    });
  }

  @Patch(":tableId")
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param("tableId") tableId: string,
    @Body() dto: UpdateTableDto,
  ): Promise<TableView> {
    return this.tables.update(tenant.restaurantId, tableId, dto);
  }

  @Post(":tableId/regenerate-token")
  regenerate(@CurrentTenant() tenant: TenantContext, @Param("tableId") tableId: string): Promise<TableView> {
    return this.tables.regenerateToken(tenant.restaurantId, tableId);
  }

  @Delete(":tableId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentTenant() tenant: TenantContext, @Param("tableId") tableId: string): Promise<void> {
    await this.tables.delete(tenant.restaurantId, tableId);
  }
}
