import type { PublicTableBill, TableSessionView } from "@app/types";
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser, Public } from "../auth/decorators";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "../restaurants/restaurant-access.guard";
import { AttendTableDto, CloseTableDto, RequestBillDto } from "./dto/orders.dto";
import { TableSessionsService } from "./table-sessions.service";

/** The floor: open table accounts, calls to the waiter, charging a table. Kitchen and riders stay out. */
@Controller("restaurants/:restaurantId/table-sessions")
@UseGuards(RestaurantAccessGuard)
@RestaurantRoles("owner", "cashier", "waiter")
export class TableSessionsController {
  constructor(private readonly sessions: TableSessionsService) {}

  @Get()
  listOpen(@CurrentTenant() tenant: TenantContext): Promise<TableSessionView[]> {
    return this.sessions.listOpen(tenant);
  }

  @Get(":sessionId")
  get(@CurrentTenant() tenant: TenantContext, @Param("sessionId") sessionId: string): Promise<TableSessionView> {
    return this.sessions.get(tenant, sessionId);
  }

  @Post(":sessionId/attend")
  @HttpCode(HttpStatus.OK)
  attend(
    @CurrentTenant() tenant: TenantContext,
    @Param("sessionId") sessionId: string,
    @Body() dto: AttendTableDto,
  ): Promise<TableSessionView> {
    return this.sessions.attend(tenant, sessionId, dto.kind);
  }

  @Post(":sessionId/close")
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
    @Body() dto: CloseTableDto,
  ): Promise<TableSessionView> {
    return this.sessions.close(tenant, user.id, sessionId, dto);
  }
}

/** The phones at a table (from its QR): the account, calling the waiter and asking for the bill. */
@Controller("public/tables/:token")
export class PublicTableSessionsController {
  constructor(private readonly sessions: TableSessionsService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get("bill")
  bill(@Param("token") token: string): Promise<PublicTableBill> {
    return this.sessions.publicBill(token);
  }

  /** Strict: pressing it again does nothing until a waiter attends, but it is reachable from outside. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("call-waiter")
  @HttpCode(HttpStatus.OK)
  callWaiter(@Param("token") token: string): Promise<PublicTableBill> {
    return this.sessions.callWaiter(token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("request-bill")
  @HttpCode(HttpStatus.OK)
  requestBill(@Param("token") token: string, @Body() dto: RequestBillDto): Promise<PublicTableBill> {
    return this.sessions.requestBill(
      token,
      dto.tip.kind === "amount" ? { kind: "amount", amount: dto.tip.amount ?? 0 } : { kind: dto.tip.kind },
    );
  }
}
