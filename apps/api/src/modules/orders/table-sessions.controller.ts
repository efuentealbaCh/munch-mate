import type { CreateTablePaymentInput, PublicTableBill, TableSessionView } from "@app/types";
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards } from "@nestjs/common";
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
  AttendTableDto,
  CloseTableDto,
  CreateTablePaymentDto,
  RequestBillDto,
  SetTableSplitDto,
} from "./dto/orders.dto";
import { TableSessionsService } from "./table-sessions.service";

/** The DTO as the discriminated input of its kind (fields of other kinds are ignored). */
function paymentInput(dto: CreateTablePaymentDto): CreateTablePaymentInput {
  const { method, tip } = dto;
  switch (dto.kind) {
    case "equal":
      return { kind: "equal", part: dto.part ?? 0, method, tip };
    case "items":
      return {
        kind: "items",
        items: (dto.items ?? []).map(({ orderId, line, quantity }) => ({ orderId, line, quantity })),
        method,
        tip,
      };
    default:
      return { kind: "amount", amount: dto.amount ?? 0, method, tip };
  }
}

/**
 * The floor: open table accounts, calls to the waiter, splitting and charging a table. Kitchen and riders
 * stay out.
 */
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

  /** How the account is split: equal parts, by products, free amounts, or `{ mode: null }`. */
  @Put(":sessionId/split")
  setSplit(
    @CurrentTenant() tenant: TenantContext,
    @Param("sessionId") sessionId: string,
    @Body() dto: SetTableSplitDto,
  ): Promise<TableSessionView> {
    return this.sessions.setSplit(
      tenant,
      sessionId,
      dto.mode === null ? null : dto.mode === "equal" ? { mode: "equal", parts: dto.parts ?? 0 } : { mode: dto.mode },
    );
  }

  /** A partial payment; the one that completes the bill closes the account. */
  @Post(":sessionId/payments")
  @HttpCode(HttpStatus.OK)
  addPayment(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param("sessionId") sessionId: string,
    @Body() dto: CreateTablePaymentDto,
  ): Promise<TableSessionView> {
    return this.sessions.addPayment(tenant, user.id, sessionId, paymentInput(dto));
  }

  @Delete(":sessionId/payments/:paymentId")
  deletePayment(
    @CurrentTenant() tenant: TenantContext,
    @Param("sessionId") sessionId: string,
    @Param("paymentId") paymentId: string,
  ): Promise<TableSessionView> {
    return this.sessions.deletePayment(tenant, sessionId, paymentId);
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
