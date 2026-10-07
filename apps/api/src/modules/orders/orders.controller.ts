import type { CreatedOrder, OrderView, PublicOrderView, TableContext } from "@app/types";
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser, Public } from "../auth/decorators";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "../restaurants/restaurant-access.guard";
import { AccessTokenDto, ChangeStatusDto, CreateDineInOrderDto, OrdersQueryDto, PaymentDto } from "./dto/orders.dto";
import { OrdersService } from "./orders.service";
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
    return this.orders.changeStatus(tenant, user.id, orderId, dto.status, dto.reason);
  }

  @Post(":orderId/payment")
  @RestaurantRoles("owner", "cashier")
  @HttpCode(HttpStatus.OK)
  markPaid(
    @CurrentTenant() tenant: TenantContext,
    @Param("orderId") orderId: string,
    @Body() dto: PaymentDto,
  ): Promise<OrderView> {
    return this.orders.markPaid(tenant, orderId, dto.method);
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
}
