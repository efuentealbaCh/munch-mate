import {
  type CreateTablePaymentInput,
  type PaymentMethod,
  type PublicTableBill,
  SPLIT_LIMITS,
  TABLE_LIMITS,
  type TableSessionView,
  type TableSplit,
  type TipChoice,
} from "@app/types";
import { equalSplitState, formatMoney, isValidSplitParts, tipFromChoice } from "@app/utils";
import {
  BadRequestException,
  ConflictException,
  type HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { apiError } from "../../common/errors/api-error";
import { PrintJobsService } from "../printing/print-jobs.service";
import { RealtimeService } from "../realtime/realtime.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import { type RestaurantRecord, RestaurantsRepository } from "../restaurants/restaurants.repository";
import { UsersRepository } from "../users/users.repository";
import { toOrderView } from "./order.views";
import { businessDate } from "./order-tokens";
import { type OrderRecord, OrdersRepository } from "./orders.repository";
import { billTotals, toPublicTableBill, toTableSessionView } from "./table-bill";
import {
  type CloseChange,
  type NewTablePayment,
  type TablePaymentRecord,
  type TableSessionRecord,
  TableSessionsRepository,
} from "./table-sessions.repository";
import {
  allocatePayments,
  dueOrders,
  itemsAmount,
  mainMethod,
  methodsOf,
  paidAmount,
  paidEqualParts,
  remaining,
  SplitError,
} from "./table-split";
import { type TableRecord, TablesRepository } from "./tables.repository";

/** How long the phones at a table keep showing "Cuenta pagada" after the account closes. */
const PAID_NOTICE_MINUTES = 30;

const qrNotFound = () =>
  new NotFoundException(apiError("TABLE_NOT_FOUND", "Este código QR no está activo. Pide ayuda al personal."));
const sessionNotFound = () =>
  new NotFoundException(apiError("TABLE_SESSION_NOT_FOUND", "Esa cuenta de mesa ya no está abierta"));
const sessionChanged = () =>
  new ConflictException(apiError("TABLE_SESSION_CHANGED", "Alguien registró otro pago de esta mesa; revisa la cuenta"));
const sessionClosed = () =>
  new ConflictException(apiError("TABLE_SESSION_CLOSED", "Esta cuenta ya se cerró; sus pagos ya no se pueden borrar"));
const paymentNotFound = () =>
  new NotFoundException(apiError("TABLE_PAYMENT_NOT_FOUND", "Ese pago ya no está en la cuenta"));
const nothingLeft = () => new ConflictException(apiError("NOTHING_TO_PAY", "No queda nada por pagar en esta mesa"));

/** The account is charged in full only once the kitchen has nothing left of it. @throws TABLE_ORDERS_IN_PROGRESS. */
function checkServed(ordersInProgress: number): void {
  if (ordersInProgress === 0) return;
  throw new ConflictException(
    apiError(
      "TABLE_ORDERS_IN_PROGRESS",
      ordersInProgress === 1
        ? "Hay un pedido de esta mesa sin servir: márcalo servido o cancélalo antes de cobrar"
        : `Hay ${ordersInProgress} pedidos de esta mesa sin servir: márcalos servidos o cancélalos antes de cobrar`,
    ),
  );
}

/**
 * Table accounts (phase 8): the dine-in orders of a table add up until the staff charge them, and the people
 * at the table can call the waiter and ask for the bill (with a tip) from the QR. The customer side is keyed by
 * the table QR only: whoever is at the table may see its account, which holds no personal data. The floor staff
 * may split the account (equal parts, by products, free amounts) and charge it in several payments, each with
 * its own method and tip; the rules live in `table-split.ts`.
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
    private readonly printing: PrintJobsService,
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
   * Sets how the account is split (or with null, removes the plan). Payments already registered stay, whatever
   * their kind; an equal split needs more parts than the equal parts already paid, and must still include the
   * highest part paid (otherwise "Parte 4" would fall outside a 3-part plan and vanish from its list).
   * @throws NotFoundException TABLE_SESSION_NOT_FOUND; BadRequestException INVALID_SPLIT_PARTS; ConflictException
   *   SPLIT_PARTS_PAID, TABLE_SESSION_CHANGED.
   */
  async setSplit(tenant: TenantContext, sessionId: string, split: TableSplit | null): Promise<TableSessionView> {
    const session = await this.sessions.findOne(tenant.restaurantId, sessionId);
    if (!session || session.status !== "open") throw sessionNotFound();
    if (split?.mode === "equal") {
      if (!isValidSplitParts(split.parts)) {
        throw new BadRequestException(
          apiError("INVALID_SPLIT_PARTS", `Divide la cuenta en ${SPLIT_LIMITS.partsMin} a ${SPLIT_LIMITS.partsMax} partes`),
        );
      }
      const paid = paidEqualParts(session.payments);
      const paidParts = paid.length;
      const highestPaid = Math.max(0, ...paid);
      if (split.parts <= paidParts) {
        throw new ConflictException(
          apiError(
            "SPLIT_PARTS_PAID",
            `Ya se ${paidParts === 1 ? "pagó 1 parte" : `pagaron ${paidParts} partes`}: divide en más partes o borra un pago`,
            { paidParts: String(paidParts) },
          ),
        );
      }
      if (split.parts < highestPaid) {
        throw new ConflictException(
          apiError(
            "SPLIT_PARTS_PAID",
            `Ya se pagó la parte ${highestPaid}: divide en al menos ${highestPaid} partes o borra ese pago`,
            { paidParts: String(paidParts), highestPaidPart: String(highestPaid) },
          ),
        );
      }
    }
    const updated = await this.sessions.setSplit(tenant.restaurantId, session.id, session.revision, split);
    if (!updated) throw await this.missed(tenant.restaurantId, session.id);
    await this.notifyChange(tenant.restaurantId, updated.id);
    return this.view(updated);
  }

  /**
   * Registers a partial payment (an equal part, some products or a free amount) with its own method and tip.
   * The server computes the amount of parts and products. The payment that completes the bill closes the
   * account in the same write, like `close`, so it needs every order served; partial payments do not.
   * @throws NotFoundException TABLE_SESSION_NOT_FOUND; BadRequestException INVALID_SPLIT_PART,
   *   INVALID_SPLIT_ITEMS, INVALID_TIP; ConflictException SPLIT_MODE_MISMATCH, SPLIT_PART_PAID, NOTHING_TO_PAY,
   *   PAYMENT_EXCEEDS_BALANCE, TABLE_ORDERS_IN_PROGRESS, TABLE_SESSION_CHANGED.
   */
  async addPayment(
    tenant: TenantContext,
    userId: string,
    sessionId: string,
    input: CreateTablePaymentInput,
  ): Promise<TableSessionView> {
    const [session, restaurant, user] = await Promise.all([
      this.sessions.findOne(tenant.restaurantId, sessionId),
      this.restaurant(tenant.restaurantId),
      this.users.findById(userId),
    ]);
    if (!session || session.status !== "open") throw sessionNotFound();
    if (!Number.isInteger(input.tip) || input.tip < 0 || input.tip > TABLE_LIMITS.tipMax) {
      throw new BadRequestException(apiError("INVALID_TIP", "Revisa el monto de la propina"));
    }
    const orders = await this.orders.listByTableSession(tenant.restaurantId, session.id);
    const left = remaining(orders, session.payments);

    let part: number | null = null;
    if (input.kind === "equal") {
      const split = session.split;
      if (split?.mode !== "equal") {
        throw new ConflictException(
          apiError("SPLIT_MODE_MISMATCH", "La cuenta no está dividida en partes iguales; revisa la cuenta"),
        );
      }
      if (!Number.isInteger(input.part) || input.part < 1 || input.part > split.parts) {
        throw new BadRequestException(apiError("INVALID_SPLIT_PART", `Elige una parte entre 1 y ${split.parts}`));
      }
      if (paidEqualParts(session.payments).includes(input.part)) {
        throw new ConflictException(apiError("SPLIT_PART_PAID", `La parte ${input.part} ya está pagada`));
      }
      part = input.part;
    }
    if (input.kind === "amount" && (!Number.isInteger(input.amount) || input.amount < 1)) {
      throw new BadRequestException(apiError("INVALID_AMOUNT", "El monto debe ser un número entero mayor que cero"));
    }
    if (dueOrders(orders).length === 0 || left <= 0) throw nothingLeft();

    let amount: number;
    switch (input.kind) {
      case "equal":
        amount = equalSplitState(left, (session.split as { parts: number }).parts, paidEqualParts(session.payments)).amount;
        break;
      case "items":
        try {
          amount = itemsAmount(orders, session.payments, input.items);
        } catch (error) {
          if (error instanceof SplitError) throw new BadRequestException(apiError(error.code, error.message));
          throw error;
        }
        break;
      case "amount":
        amount = input.amount;
        break;
    }
    if (amount > left) {
      throw new ConflictException(
        apiError("PAYMENT_EXCEEDS_BALANCE", `El monto supera lo que falta por pagar (${formatMoney(left, restaurant.currency)})`, {
          remaining: String(left),
        }),
      );
    }
    const completes = amount === left;
    if (completes) checkServed(billTotals(orders).ordersInProgress);

    return this.charge(tenant, session, orders, restaurant, {
      payment: {
        kind: input.kind,
        amount,
        tip: input.tip,
        method: input.method,
        part,
        items: input.kind === "items" ? input.items.map((item) => ({ ...item })) : [],
        at: new Date(),
        byUserId: userId,
        byName: user?.name ?? null,
      },
      close: completes ? { byUserId: userId, byName: user?.name ?? null, extraTip: 0, fallbackMethod: input.method } : null,
    });
  }

  /**
   * Deletes a payment registered by mistake, while the account is open.
   * @throws NotFoundException TABLE_SESSION_NOT_FOUND, TABLE_PAYMENT_NOT_FOUND; ConflictException TABLE_SESSION_CLOSED.
   */
  async deletePayment(tenant: TenantContext, sessionId: string, paymentId: string): Promise<TableSessionView> {
    const session = await this.sessions.findOne(tenant.restaurantId, sessionId);
    if (!session) throw sessionNotFound();
    if (session.status !== "open") throw sessionClosed();
    if (!session.payments.some((payment) => payment.id === paymentId)) throw paymentNotFound();
    const updated = await this.sessions.deletePayment(tenant.restaurantId, session.id, paymentId);
    if (!updated) {
      // Closed, or the same payment deleted by someone else, a moment ago.
      const current = await this.sessions.findOne(tenant.restaurantId, session.id);
      throw current && current.status !== "open" ? sessionClosed() : paymentNotFound();
    }
    await this.notifyChange(tenant.restaurantId, updated.id);
    return this.view(updated);
  }

  /**
   * Charges what is left of the account ("Cobrar lo que falta"): one payment of the remaining amount with
   * `method` and the tip, then the account closes and its orders are paid with their share of every payment.
   * When the payments already cover everything (the account stayed open while the kitchen finished), it just
   * closes, and the tip given here is added to the payments' tips. The tip is for the waiters, not sales.
   * @throws NotFoundException TABLE_SESSION_NOT_FOUND; ConflictException TABLE_ORDERS_IN_PROGRESS, TABLE_OVERPAID,
   *   TABLE_SESSION_CHANGED.
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
    checkServed(totals.ordersInProgress);
    const left = remaining(orders, session.payments);
    if (left < 0) {
      // An order was cancelled after the table paid for it: the extra money must be returned and its payment
      // deleted (or reduced) before the orders can be marked paid with exact shares.
      throw new ConflictException(
        apiError(
          "TABLE_OVERPAID",
          `Los pagos registrados superan la cuenta en ${formatMoney(-left, restaurant.currency)}: borra el pago que sobra antes de cerrar`,
          { excess: String(-left) },
        ),
      );
    }
    const byName = user?.name ?? null;
    const tip = totals.orderCount === 0 ? 0 : input.tip;
    return this.charge(tenant, session, orders, restaurant, {
      payment:
        left > 0
          ? { kind: "amount", amount: left, tip, method: input.method, part: null, items: [], at: new Date(), byUserId: userId, byName }
          : null,
      close: { byUserId: userId, byName, extraTip: left > 0 ? 0 : tip, fallbackMethod: input.method },
    });
  }

  /**
   * Writes a payment and/or the closing of an account on the revision it was computed on, in one transaction
   * with the payment of its orders, then tells the board, the floor and the table.
   */
  private async charge(
    tenant: TenantContext,
    session: TableSessionRecord,
    orders: readonly OrderRecord[],
    restaurant: RestaurantRecord,
    change: {
      payment: NewTablePayment | null;
      close: { byUserId: string; byName: string | null; extraTip: number; fallbackMethod: PaymentMethod } | null;
    },
  ): Promise<TableSessionView> {
    const { payment, close } = change;
    const payments = payment ? [...session.payments, payment] : session.payments;
    const methods = methodsOf(payments);
    const closing: CloseChange | null = close
      ? {
          tip: payments.reduce((sum, p) => sum + p.tip, 0) + close.extraTip,
          // One method for every payment (or none, nothing was left): the account shows it; several: "Dividido".
          paymentMethod: methods.length === 0 ? close.fallbackMethod : methods.length === 1 ? methods[0]! : null,
          paymentMethods: methods.length === 0 ? [close.fallbackMethod] : methods,
          byUserId: close.byUserId,
          byName: close.byName,
          businessDate: businessDate(new Date(), restaurant.timezone),
        }
      : null;

    const updated = await this.connection.transaction(async (tx) => {
      const result = await this.sessions.charge(tenant.restaurantId, session.id, session.revision, payment, closing, tx);
      // Another waiter charged, deleted a payment or changed the plan between our read and our write.
      if (!result) throw await this.missed(tenant.restaurantId, session.id);
      if (closing) {
        const shares = allocatePayments(orders, result.payments);
        await this.orders.payTableOrders(
          tenant.restaurantId,
          session.id,
          dueOrders(orders).map((order) => {
            const breakdown = shares.get(order.id) ?? [];
            return { orderId: order.id, method: mainMethod(breakdown) ?? close!.fallbackMethod, breakdown };
          }),
          tx,
        );
      }
      return result;
    });

    // $push appends: the payment just recorded is the last one.
    const recorded = payment ? updated.payments.at(-1) : undefined;
    if (recorded) await this.printReceipt(tenant.restaurantId, updated, orders, recorded, closing !== null);
    if (!closing) {
      await this.notifyChange(tenant.restaurantId, updated.id);
      return toTableSessionView(updated, orders, restaurant);
    }
    // The board shows each order as paid; the floor and the table see the account closed.
    const paidOrders = await this.orders.listByTableSession(tenant.restaurantId, session.id);
    for (const order of paidOrders) this.realtime.toRestaurant(tenant.restaurantId).emit("order.updated", toOrderView(order));
    await this.notifyChange(tenant.restaurantId, updated.id);
    return toTableSessionView(updated, paidOrders, restaurant);
  }

  /**
   * The payment receipt of a payment just recorded, on the print agents' receipt printers (never fails the
   * payment: `PrintJobsService` logs its errors).
   * @param orders The account's orders as the payment was computed (before closing paid them).
   */
  private async printReceipt(
    restaurantId: string,
    session: TableSessionRecord,
    orders: readonly OrderRecord[],
    payment: TablePaymentRecord,
    closed: boolean,
  ): Promise<void> {
    const paid = paidAmount(session.payments);
    const left = closed ? 0 : Math.max(0, remaining(orders, session.payments));
    const byId = new Map(orders.map((order) => [order.id, order]));
    await this.printing.tablePayment(restaurantId, {
      sessionId: session.id,
      paymentId: payment.id,
      tableLabel: session.tableLabel,
      at: payment.at,
      byName: payment.byName,
      method: payment.method,
      payment: {
        kind: payment.kind,
        part: payment.part,
        parts: session.split?.mode === "equal" ? session.split.parts : null,
        amount: payment.amount,
        tip: payment.tip,
        items: payment.items.flatMap((item) => {
          const line = byId.get(item.orderId)?.items[item.line];
          if (!line) return [];
          return [
            {
              quantity: item.quantity,
              name: line.name,
              details: line.modifiers.map((m) => `${m.groupName}: ${m.optionName}`),
              // lineTotal = unit (options included) × quantity, so the division is exact.
              amount: (line.lineTotal / line.quantity) * item.quantity,
            },
          ];
        }),
      },
      account: { total: paid + left, paid, remaining: left, closed },
    });
  }

  /** Why a conditional write on an account missed: it is not open any more (404), or it changed (409). */
  private async missed(restaurantId: string, sessionId: string): Promise<HttpException> {
    const current = await this.sessions.findOne(restaurantId, sessionId);
    return current?.status === "open" ? sessionChanged() : sessionNotFound();
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
