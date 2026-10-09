import type {
  CreatedOrder,
  DailySummary,
  OrderView,
  PublicOrderView,
  RiderPosition,
  RiderView,
  TableContext,
} from "@app/types";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { Throttle } from "@nestjs/throttler";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser, Public } from "../auth/decorators";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "../restaurants/restaurant-access.guard";
import {
  AccessTokenDto,
  AssignRiderDto,
  ChangeStatusDto,
  CreateDeliveryOrderDto,
  CreateDineInOrderDto,
  CreatePickupOrderDto,
  DailySummaryQueryDto,
  OrdersQueryDto,
  PaymentDto,
} from "./dto/orders.dto";
import { OrdersService, type ReceiptResult } from "./orders.service";
import { TablesService } from "./tables.service";

/** Staff side: the kitchen board and the cashier. Which status changes each role may make is in @app/utils. */
@Controller("restaurants/:restaurantId/orders")
@UseGuards(RestaurantAccessGuard)
@RestaurantRoles("owner", "cashier", "kitchen")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext, @Query() query: OrdersQueryDto): Promise<OrderView[]> {
    return this.orders.list(tenant, query.scope ?? "active");
  }

  @Get(":orderId")
  get(@CurrentTenant() tenant: TenantContext, @Param("orderId") orderId: string): Promise<OrderView> {
    return this.orders.get(tenant, orderId);
  }

  @Post(":orderId/status")
  @HttpCode(HttpStatus.OK)
  changeStatus(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param("orderId") orderId: string,
    @Body() dto: ChangeStatusDto,
  ): Promise<OrderView> {
    return this.orders.changeStatus(tenant, user.id, orderId, dto.status, dto.reason, dto.readyInMinutes);
  }

  /** Last position of the rider (null when not on its way or no report yet). */
  @Get(":orderId/rider-location")
  async riderLocation(
    @CurrentTenant() tenant: TenantContext,
    @Param("orderId") orderId: string,
  ): Promise<{ position: RiderPosition | null }> {
    return { position: await this.orders.riderPosition(tenant, orderId) };
  }

  /** 202 `{ status: "pending" }` while the workers generate it; the PDF once ready. */
  @Get(":orderId/receipt")
  async receipt(
    @CurrentTenant() tenant: TenantContext,
    @Param("orderId") orderId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | { status: "pending" }> {
    return sendReceipt(await this.orders.getReceipt(tenant, orderId), res);
  }

  @Post(":orderId/payment")
  @RestaurantRoles("owner", "cashier")
  @HttpCode(HttpStatus.OK)
  markPaid(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param("orderId") orderId: string,
    @Body() dto: PaymentDto,
  ): Promise<OrderView> {
    return this.orders.markPaid(tenant, user.id, orderId, dto.method);
  }

  /** Optional: deliveries without a rider are dispatched by the floor staff. */
  @Put(":orderId/rider")
  @RestaurantRoles("owner", "cashier")
  assignRider(
    @CurrentTenant() tenant: TenantContext,
    @Param("orderId") orderId: string,
    @Body() dto: AssignRiderDto,
  ): Promise<OrderView> {
    return this.orders.assignRider(tenant, orderId, dto.riderId);
  }
}

/** Sales reports for the owner and the cashier (closing the register). */
@Controller("restaurants/:restaurantId/reports")
@UseGuards(RestaurantAccessGuard)
@RestaurantRoles("owner", "cashier")
export class ReportsController {
  constructor(private readonly orders: OrdersService) {}

  @Get("daily")
  daily(@CurrentTenant() tenant: TenantContext, @Query() query: DailySummaryQueryDto): Promise<DailySummary> {
    return this.orders.dailySummary(tenant, query.date);
  }
}

/** Members with the rider role, for the assignment picker on the board. */
@Controller("restaurants/:restaurantId/riders")
@UseGuards(RestaurantAccessGuard)
@RestaurantRoles("owner", "cashier")
export class RidersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<RiderView[]> {
    return this.orders.listRiders(tenant.restaurantId);
  }
}

/**
 * The rider's screen: only the deliveries assigned to them. The service rejects any other order
 * (NOT_YOUR_DELIVERY), and the state machine only lets riders take orders out and hand them over.
 */
@Controller("restaurants/:restaurantId/deliveries")
@UseGuards(RestaurantAccessGuard)
@RestaurantRoles("rider")
export class RiderDeliveriesController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext, @CurrentUser() user: AuthUser): Promise<OrderView[]> {
    return this.orders.listForRider(tenant, user.id);
  }

  @Post(":orderId/status")
  @HttpCode(HttpStatus.OK)
  changeStatus(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param("orderId") orderId: string,
    @Body() dto: ChangeStatusDto,
  ): Promise<OrderView> {
    return this.orders.changeStatus(tenant, user.id, orderId, dto.status, dto.reason, dto.readyInMinutes);
  }

  /** Cash on delivery (or card terminal / transfer) collected by the rider. */
  @Post(":orderId/payment")
  @HttpCode(HttpStatus.OK)
  markPaid(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param("orderId") orderId: string,
    @Body() dto: PaymentDto,
  ): Promise<OrderView> {
    return this.orders.markPaid(tenant, user.id, orderId, dto.method);
  }
}

/** Customer side: no account. A table QR opens the menu; the tracking token is the key to one order. */
@Controller("public")
export class PublicOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly tables: TablesService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get("tables/:token")
  table(@Param("token") token: string): Promise<TableContext> {
    return this.tables.contextForToken(token);
  }

  /** Generous limit: a whole restaurant can share one Wi-Fi (one public IP) at rush hour. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("tables/:token/orders")
  create(@Param("token") token: string, @Body() dto: CreateDineInOrderDto): Promise<CreatedOrder> {
    return this.orders.createDineIn(token, dto);
  }

  /**
   * Pickup from the public menu. Stricter than dine-in: anyone on the internet can call it, so besides this
   * per-IP limit the service caps the orders in progress per phone.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("restaurants/:slug/orders")
  createPickup(@Param("slug") slug: string, @Body() dto: CreatePickupOrderDto): Promise<CreatedOrder> {
    return this.orders.createPickup(slug, dto);
  }

  /** Delivery from the public menu; same limits as pickup. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("restaurants/:slug/delivery-orders")
  createDelivery(@Param("slug") slug: string, @Body() dto: CreateDeliveryOrderDto): Promise<CreatedOrder> {
    return this.orders.createDelivery(slug, dto);
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post("orders/lookup")
  @HttpCode(HttpStatus.OK)
  lookup(@Body() dto: AccessTokenDto): Promise<PublicOrderView> {
    return this.orders.findForCustomer(dto.accessToken);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("orders/cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Body() dto: AccessTokenDto): Promise<PublicOrderView> {
    return this.orders.cancelByCustomer(dto.accessToken);
  }

  /** The rider's last position, to draw the map before the next live update arrives. */
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post("orders/rider-location")
  @HttpCode(HttpStatus.OK)
  async riderLocation(@Body() dto: AccessTokenDto): Promise<{ position: RiderPosition | null }> {
    return { position: await this.orders.riderPositionForCustomer(dto.accessToken) };
  }

  /** POST so the tracking token stays in the body (and out of access logs); the web saves the blob. */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("orders/receipt")
  async receipt(
    @Body() dto: AccessTokenDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | { status: "pending" }> {
    return sendReceipt(await this.orders.getReceiptForCustomer(dto.accessToken), res);
  }
}

function sendReceipt(result: ReceiptResult, res: Response): StreamableFile | { status: "pending" } {
  if (result.status === "pending") {
    res.status(HttpStatus.ACCEPTED);
    return { status: "pending" };
  }
  res.status(HttpStatus.OK);
  return new StreamableFile(result.pdf, {
    type: "application/pdf",
    disposition: `attachment; filename="${result.filename}"`,
  });
}
