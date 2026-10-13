import type { PaymentMethod, PublicTableBill, TableSessionView, TipChoice } from "@app/types";
import { tipFromChoice } from "@app/utils";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { apiError } from "../../common/errors/api-error";
import { RealtimeService } from "../realtime/realtime.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import { type RestaurantRecord, RestaurantsRepository } from "../restaurants/restaurants.repository";
import { UsersRepository } from "../users/users.repository";
import { toOrderView } from "./order.views";
import { businessDate } from "./order-tokens";
import { OrdersRepository } from "./orders.repository";
import { billTotals, toPublicTableBill, toTableSessionView } from "./table-bill";
import { type TableSessionRecord, TableSessionsRepository } from "./table-sessions.repository";
import { type TableRecord, TablesRepository } from "./tables.repository";

/** How long the phones at a table keep showing "Cuenta pagada" after the account closes. */
const PAID_NOTICE_MINUTES = 30;

const qrNotFound = () =>
  new NotFoundException(apiError("TABLE_NOT_FOUND", "Este código QR no está activo. Pide ayuda al personal."));
const sessionNotFound = () =>
  new NotFoundException(apiError("TABLE_SESSION_NOT_FOUND", "Esa cuenta de mesa ya no está abierta"));

/**
 * Table accounts (phase 8): the dine-in orders of a table add up until the staff charge them, and the people
 * at the table can call the waiter and ask for the bill (with a tip) from the QR. The customer side is keyed by
 * the table QR only: whoever is at the table may see its account, which holds no personal data.
 */
@Injectable()
export class TableSessionsService {
  constructor(
    private readonly sessions: TableSessionsRepository,
    private readonly orders: OrdersRepository,
    private readonly tables: TablesRepository,
    private readonly restaurants: RestaurantsRepository,
    private readonly users: UsersRepository,
    private readonly realtime: RealtimeService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ── Customers (table QR) ────────────────────────────────────────────────

  /** The table's open account, or the one just paid. @throws NotFoundException TABLE_NOT_FOUND. */
  async publicBill(tableToken: string): Promise<PublicTableBill> {
    const { table, restaurant } = await this.tableForToken(tableToken);
    return this.publicBillOf(table, restaurant);
  }

  /** "Llamar al garzón": opens the account if needed (the customer may not have ordered yet). */
  async callWaiter(tableToken: string): Promise<PublicTableBill> {
    const { table, restaurant } = await this.tableForToken(tableToken);
    const session = await this.sessions.getOrOpen(restaurant.id, table);
    await this.sessions.callWaiter(restaurant.id, session.id);
    await this.notifyChange(restaurant.id, session.id);
    return this.publicBillOf(table, restaurant);
  }

  /**
   * "Pedir la cuenta" with the tip the customer chooses (voluntary; the waiter confirms it when charging).
   * @throws ConflictException NOTHING_TO_PAY; BadRequestException INVALID_TIP.
   */
  async requestBill(tableToken: string, tip: TipChoice): Promise<PublicTableBill> {
    const { table, restaurant } = await this.tableForToken(tableToken);
    const session = await this.sessions.findOpenByTable(restaurant.id, table.id);
    const totals = session ? billTotals(await this.orders.listByTableSession(restaurant.id, session.id)) : null;
    if (!session || !totals || totals.orderCount === 0) {
      throw new ConflictException(apiError("NOTHING_TO_PAY", "Todavía no hay pedidos en la cuenta de esta mesa"));
    }
    const amount = tipFromChoice(tip, totals.subtotal, restaurant.tipPercent);
    if (amount === null) throw new BadRequestException(apiError("INVALID_TIP", "Revisa el monto de la propina"));
    await this.sessions.requestBill(restaurant.id, session.id, amount);
    await this.notifyChange(restaurant.id, session.id);
    return this.publicBillOf(table, restaurant);
  }

  /** @returns The table id behind a QR (Socket.IO subscriptions), or null. */
  async tableIdForToken(tableToken: string): Promise<string | null> {
    try {
      return (await this.tableForToken(tableToken)).table.id;
    } catch {
      return null;
    }
  }

  // ── Floor staff ─────────────────────────────────────────────────────────

  /** Open accounts, oldest first, with their lines and calls. */
  async listOpen(tenant: TenantContext): Promise<TableSessionView[]> {
    const restaurant = await this.restaurant(tenant.restaurantId);
    const sessions = await this.sessions.listOpen(tenant.restaurantId);
    const ordersBySession = await this.orders.listByTableSessions(tenant.restaurantId, sessions.map((s) => s.id));
    return sessions.map((s) => toTableSessionView(s, ordersBySession.get(s.id) ?? [], restaurant));
  }

  /** @throws NotFoundException TABLE_SESSION_NOT_FOUND. */
  async get(tenant: TenantContext, sessionId: string): Promise<TableSessionView> {
    const session = await this.sessions.findOne(tenant.restaurantId, sessionId);
    if (!session) throw sessionNotFound();
    return this.view(session);
  }

  /** A waiter attended the call or the bill request (the alert leaves every screen). */
  async attend(tenant: TenantContext, sessionId: string, kind: "waiter" | "bill"): Promise<TableSessionView> {
    const session = await this.sessions.attend(tenant.restaurantId, sessionId, kind);
    if (!session) throw sessionNotFound();
    await this.notifyChange(tenant.restaurantId, session.id);
    return this.view(session);
  }

  /**
   * Charges the account: every unpaid order is paid with `method`, the tip is recorded for the waiters (not
   * part of sales) and the account closes; the next order of the table opens a new one.
   * @throws NotFoundException TABLE_SESSION_NOT_FOUND; ConflictException TABLE_ORDERS_IN_PROGRESS.
   */
  async close(
    tenant: TenantContext,
    userId: string,
    sessionId: string,
    input: { method: PaymentMethod; tip: number },
  ): Promise<TableSessionView> {
    const [session, restaurant, user] = await Promise.all([
      this.sessions.findOne(tenant.restaurantId, sessionId),
      this.restaurant(tenant.restaurantId),
      this.users.findById(userId),
    ]);
    if (!session || session.status !== "open") throw sessionNotFound();
    const orders = await this.orders.listByTableSession(tenant.restaurantId, session.id);
    const totals = billTotals(orders);
    if (totals.ordersInProgress > 0) {
      throw new ConflictException(
        apiError(
          "TABLE_ORDERS_IN_PROGRESS",
          totals.ordersInProgress === 1
            ? "Hay un pedido de esta mesa sin servir: márcalo servido o cancélalo antes de cobrar"
            : `Hay ${totals.ordersInProgress} pedidos de esta mesa sin servir: márcalos servidos o cancélalos antes de cobrar`,
        ),
      );
    }

    const closed = await this.connection.transaction(async (tx) => {
      const result = await this.sessions.close(
        tenant.restaurantId,
        session.id,
        {
          tip: totals.orderCount === 0 ? 0 : input.tip,
          method: input.method,
          byUserId: userId,
          byName: user?.name ?? null,
          businessDate: businessDate(new Date(), restaurant.timezone),
        },
        tx,
      );
      // Another waiter charged it a moment ago.
      if (!result) throw sessionNotFound();
      await this.orders.payTableSession(tenant.restaurantId, session.id, input.method, tx);
      return result;
    });

    // The board shows each order as paid; the floor and the table see the account closed.
    const paidOrders = await this.orders.listByTableSession(tenant.restaurantId, session.id);
    for (const order of paidOrders) this.realtime.toRestaurant(tenant.restaurantId).emit("order.updated", toOrderView(order));
    await this.notifyChange(tenant.restaurantId, closed.id);
    return toTableSessionView(closed, paidOrders, restaurant);
  }

  /** Tips of the accounts closed on business days from..to, per day (reports). */
  async tipsByDay(restaurantId: string, from: string, to: string): Promise<Map<string, number>> {
    const tips = new Map<string, number>();
    for (const session of await this.sessions.listClosedBetween(restaurantId, from, to)) {
      const day = session.closedBusinessDate!;
      tips.set(day, (tips.get(day) ?? 0) + (session.tip ?? 0));
    }
    return tips;
  }

  /**
   * Tells the floor (staff) and the phones at the table that an account changed: a new or updated order,
   * a call, a bill request, a payment. Called by the orders service for dine-in orders too.
   */
  async notifyChange(restaurantId: string, sessionId: string): Promise<void> {
    const [session, restaurant] = await Promise.all([
      this.sessions.findOne(restaurantId, sessionId),
      this.restaurants.findById(restaurantId),
    ]);
    if (!session || !restaurant) return;
    const orders = await this.orders.listByTableSession(restaurantId, session.id);
    this.realtime.toRestaurant(restaurantId).emit("table.updated", toTableSessionView(session, orders, restaurant));
    this.realtime
      .toTable(session.tableId)
      .emit("table.bill", toPublicTableBill(session.tableLabel, session, orders, restaurant));
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async publicBillOf(table: TableRecord, restaurant: RestaurantRecord): Promise<PublicTableBill> {
    const session =
      (await this.sessions.findOpenByTable(restaurant.id, table.id)) ??
      (await this.sessions.findRecentlyClosedByTable(
        restaurant.id,
        table.id,
        new Date(Date.now() - PAID_NOTICE_MINUTES * 60_000),
      ));
    const orders = session ? await this.orders.listByTableSession(restaurant.id, session.id) : [];
    return toPublicTableBill(table.label, session, orders, restaurant);
  }

  private async view(session: TableSessionRecord): Promise<TableSessionView> {
    const [orders, restaurant] = await Promise.all([
      this.orders.listByTableSession(session.restaurantId, session.id),
      this.restaurant(session.restaurantId),
    ]);
    return toTableSessionView(session, orders, restaurant);
  }

  /** Inactive tables and suspended restaurants answer like unknown QR codes. */
  private async tableForToken(token: string): Promise<{ table: TableRecord; restaurant: RestaurantRecord }> {
    const table = await this.tables.findByToken(token);
    const restaurant = table?.active ? await this.restaurants.findById(table.restaurantId) : null;
    if (!table || !restaurant || restaurant.status !== "active") throw qrNotFound();
    return { table, restaurant };
  }

  private async restaurant(id: string): Promise<RestaurantRecord> {
    const restaurant = await this.restaurants.findById(id);
    if (!restaurant) throw sessionNotFound();
    return restaurant;
  }
}
