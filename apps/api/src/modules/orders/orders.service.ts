import {
  type CreateDeliveryOrderInput,
  type DailySummary,
  type CreateDineInOrderInput,
  type CreatedOrder,
  type CreatePickupOrderInput,
  type OrderItemInput,
  ORDER_LIMITS,
  type OrderStatus,
  type OrderView,
  type PaymentMethod,
  type PublicOrderView,
  READY_MINUTES_BY_CHANNEL,
  type RiderPosition,
  type RestaurantRole,
  type RiderView,
} from "@app/types";
import { checkTransition, formatMoney, normalizePhone, roundCoord } from "@app/utils";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectConnection } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { hashToken } from "../../common/crypto/tokens";
import { apiError } from "../../common/errors/api-error";
import type { ApiEnv } from "../../config/env.validation";
import { PdfQueue } from "../../infra/queue/pdf.queue";
import { StorageService } from "../../infra/storage/storage.service";
import { CategoriesRepository } from "../menu/categories.repository";
import { ModifierGroupsRepository } from "../menu/modifier-groups.repository";
import { ProductsRepository } from "../menu/products.repository";
import { RealtimeService } from "../realtime/realtime.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import { type RestaurantRecord, RestaurantsRepository } from "../restaurants/restaurants.repository";
import { MembershipsRepository } from "../restaurants/memberships.repository";
import { openState } from "../restaurants/restaurant.views";
import { UsersRepository } from "../users/users.repository";
import { DeliveryZonesRepository } from "./delivery-zones.repository";
import { OrderValidationError, type PricingMenu, priceOrder } from "./order-pricing";
import { businessDate, deriveAccessToken, isCalendarDate } from "./order-tokens";
import { MapsService } from "../maps/maps.service";
import { summarizeDay } from "./daily-summary";
import { RiderTrackingService } from "./rider-tracking.service";
import { hasReceipt, receiptKey, toExpectedPaymentView, toOrderView, toPublicOrderView } from "./order.views";
import { CountersRepository } from "./counters.repository";
import { DUPLICATE_KEY, type NewOrder, type OrderRecord, OrdersRepository } from "./orders.repository";
import { TablesRepository } from "./tables.repository";

const orderNotFound = () => new NotFoundException(apiError("ORDER_NOT_FOUND", "No encontramos ese pedido"));
const tableNotFound = () =>
  new NotFoundException(apiError("TABLE_NOT_FOUND", "Este código QR no está activo. Pide ayuda al personal."));
const menuNotFound = () => new NotFoundException(apiError("MENU_NOT_FOUND", "No encontramos ese restaurante"));
const notAccepting = () =>
  new ConflictException(apiError("NOT_ACCEPTING_ORDERS", "El local no está recibiendo pedidos en este momento"));

/** The customer's side of a new order, common to every channel. */
interface OrderRequest {
  clientOrderId: string;
  items: OrderItemInput[];
  note?: string;
}

/** What each channel adds to the order (who and where). */
type ChannelFields = Pick<
  NewOrder,
  | "channel"
  | "customerName"
  | "customerPhone"
  | "customerEmail"
  | "tableId"
  | "tableLabel"
  | "delivery"
  | "expectedPayment"
>;

/** Defaults of the channel fields; each channel overrides what it uses. */
const NO_CONTACT = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  tableId: null,
  tableLabel: null,
  delivery: null,
  expectedPayment: null,
} satisfies Omit<ChannelFields, "channel">;

/** Roles that work the whole board; anyone else (riders) only acts on deliveries assigned to them. */
const FLOOR_ROLES: readonly RestaurantRole[] = ["owner", "cashier", "kitchen"];
const isFloor = (roles: readonly RestaurantRole[]) => roles.some((role) => FLOOR_ROLES.includes(role));
const notYourDelivery = () =>
  new ForbiddenException(apiError("NOT_YOUR_DELIVERY", "Este reparto no está asignado a ti"));

export type ReceiptResult = { status: "pending" } | { status: "ready"; pdf: Buffer; filename: string };

@Injectable()
export class OrdersService {
  private readonly tokenSecret: string;
  private readonly appUrl: string;

  constructor(
    private readonly orders: OrdersRepository,
    private readonly counters: CountersRepository,
    private readonly tables: TablesRepository,
    private readonly restaurants: RestaurantsRepository,
    private readonly categories: CategoriesRepository,
    private readonly products: ProductsRepository,
    private readonly modifierGroups: ModifierGroupsRepository,
    private readonly users: UsersRepository,
    private readonly memberships: MembershipsRepository,
    private readonly deliveryZones: DeliveryZonesRepository,
    private readonly realtime: RealtimeService,
    private readonly pdfQueue: PdfQueue,
    private readonly storage: StorageService,
    @InjectConnection() private readonly connection: Connection,
    config: ConfigService<ApiEnv, true>,
    private readonly tracking: RiderTrackingService,
    private readonly maps: MapsService,
  ) {
    this.tokenSecret = config.get("ORDER_TOKEN_SECRET", { infer: true });
    this.appUrl = config.get("APP_URL", { infer: true });
  }

  /**
   * Places a dine-in order from a table QR. Prices come from the current menu; the order starts "pending"
   * until the staff accepts it. Idempotent per `clientOrderId`: a retried submission returns the order
   * already created (with the same tracking token) instead of a duplicate.
   * @throws NotFoundException TABLE_NOT_FOUND; ConflictException NOT_ACCEPTING_ORDERS, PRODUCT_SOLD_OUT,
   *   PRODUCT_NOT_AVAILABLE, OPTION_SOLD_OUT, INVALID_MODIFIERS.
   */
  async createDineIn(tableToken: string, input: CreateDineInOrderInput): Promise<CreatedOrder> {
    const table = await this.tables.findByToken(tableToken);
    const restaurant = table?.active ? await this.restaurants.findById(table.restaurantId) : null;
    if (!table || !restaurant || restaurant.status !== "active") throw tableNotFound();

    return this.placeOrder(restaurant, input, async () => ({
      fields: {
        ...NO_CONTACT,
        channel: "dine_in",
        customerName: input.customerName?.trim() ?? "",
        tableId: table.id,
        tableLabel: table.label,
      },
    }));
  }

  /**
   * Places a pickup order from the public menu. Same pricing and idempotency as dine-in; on top of the IP
   * rate limit, a phone may only have a few orders in progress per restaurant (fake-order floods).
   * @throws NotFoundException MENU_NOT_FOUND; BadRequestException INVALID_PHONE; ConflictException
   *   PICKUP_DISABLED, NOT_ACCEPTING_ORDERS and the pricing errors; 429 TOO_MANY_ACTIVE_ORDERS.
   */
  async createPickup(slug: string, input: CreatePickupOrderInput): Promise<CreatedOrder> {
    const restaurant = await this.publicRestaurant(slug);
    const contact = this.contact(input);

    return this.placeOrder(restaurant, input, async () => {
      if (!restaurant.pickupEnabled) {
        throw new ConflictException(apiError("PICKUP_DISABLED", "Este local no recibe pedidos para retirar"));
      }
      await this.checkPhoneLimit(restaurant.id, contact.customerPhone);
      return { fields: { ...NO_CONTACT, ...contact, channel: "pickup" } };
    });
  }

  /**
   * Places a delivery order. The chosen zone (of this restaurant, active) sets the fee added to the total and
   * the minimum subtotal; the expected payment lets the rider bring change for cash.
   * @throws NotFoundException MENU_NOT_FOUND; BadRequestException INVALID_PHONE, CASH_AMOUNT_TOO_LOW;
   *   ConflictException DELIVERY_DISABLED, ZONE_NOT_AVAILABLE, BELOW_MINIMUM_ORDER, NOT_ACCEPTING_ORDERS and
   *   the pricing errors; 429 TOO_MANY_ACTIVE_ORDERS.
   */
  async createDelivery(slug: string, input: CreateDeliveryOrderInput): Promise<CreatedOrder> {
    const restaurant = await this.publicRestaurant(slug);
    const contact = this.contact(input);

    return this.placeOrder(restaurant, input, async () => {
      if (!restaurant.deliveryEnabled) {
        throw new ConflictException(apiError("DELIVERY_DISABLED", "Este local no hace despacho a domicilio"));
      }
      const zone = await this.deliveryZones.findOne(restaurant.id, input.delivery.zoneId);
      if (!zone?.active) {
        throw new ConflictException(
          apiError("ZONE_NOT_AVAILABLE", "El local ya no reparte en esa zona; elige otra o pide para retirar"),
        );
      }
      const pin = input.delivery.location
        ? { lat: roundCoord(input.delivery.location.lat), lng: roundCoord(input.delivery.location.lng) }
        : null;
      // A zone drawn on the map is checked against the pin: the address text alone cannot prove where it is.
      // Without the base map (not uploaded) customers may have no way to place one, so the pin is then
      // optional and the zone is taken by name, as before phase 7; a pin that is sent is still checked.
      if (zone.area && (pin || (await this.maps.isAvailable()))) {
        if (!pin) {
          throw new BadRequestException(apiError("LOCATION_REQUIRED", "Marca en el mapa dónde entregamos tu pedido"));
        }
        if (!(await this.deliveryZones.contains(restaurant.id, zone.id, pin))) {
          throw new ConflictException(
            apiError("OUTSIDE_ZONE", `Tu ubicación queda fuera de ${zone.name}; revisa el pin o elige otra zona`),
          );
        }
      }
      await this.checkPhoneLimit(restaurant.id, contact.customerPhone);
      const cash = input.payment.method === "cash" ? (input.payment.cashAmount ?? null) : null;

      return {
        fields: {
          ...NO_CONTACT,
          ...contact,
          channel: "delivery",
          delivery: {
            zoneId: zone.id,
            zoneName: zone.name,
            address: input.delivery.address.trim(),
            unit: input.delivery.unit?.trim() ?? "",
            reference: input.delivery.reference?.trim() ?? "",
            location: pin,
          },
          expectedPayment: { method: input.payment.method, cashAmount: cash },
        },
        deliveryFee: (subtotal) => {
          if (subtotal < zone.minOrder) {
            throw new ConflictException(
              apiError(
                "BELOW_MINIMUM_ORDER",
                `El pedido mínimo para ${zone.name} es ${formatMoney(zone.minOrder, restaurant.currency)}`,
                { minOrder: String(zone.minOrder) },
              ),
            );
          }
          if (cash !== null && cash < subtotal + zone.fee) {
            throw new BadRequestException(
              apiError("CASH_AMOUNT_TOO_LOW", "El monto con que pagas debe cubrir el total del pedido"),
            );
          }
          return zone.fee;
        },
      };
    });
  }

  /**
   * Shared by every channel: idempotency, open/closed check, server-side pricing and atomic numbering.
   * @param prepare Channel-specific checks and fields, run only for new orders (a retried submission skips
   *   them, so the customer always gets back the order already placed). `deliveryFee` may reject the
   *   subtotal and returns the fee added to the total.
   */
  private async placeOrder(
    restaurant: RestaurantRecord,
    input: OrderRequest,
    prepare: () => Promise<{ fields: ChannelFields; deliveryFee?: (subtotal: number) => number }>,
  ): Promise<CreatedOrder> {
    const accessToken = deriveAccessToken(this.tokenSecret, restaurant.id, input.clientOrderId);
    const existing = await this.orders.findByClientOrderId(restaurant.id, input.clientOrderId);
    if (existing) return { accessToken, order: this.publicView(existing, restaurant) };

    if (!restaurant.acceptingOrders) throw notAccepting();
    const schedule = openState(restaurant);
    if (!schedule.openNow) {
      throw new ConflictException(
        apiError(
          "OUTSIDE_OPENING_HOURS",
          "El local está fuera de su horario de atención",
          schedule.nextOpeningAt ? { nextOpeningAt: schedule.nextOpeningAt } : undefined,
        ),
      );
    }
    const units = input.items.reduce((sum, item) => sum + item.quantity, 0);
    if (units > restaurant.maxItemsPerOrder) {
      throw new ConflictException(
        apiError(
          "TOO_MANY_ITEMS",
          `Este local acepta hasta ${restaurant.maxItemsPerOrder} ${restaurant.maxItemsPerOrder === 1 ? "producto" : "productos"} por pedido; quita algunos o haz otro pedido`,
          { max: String(restaurant.maxItemsPerOrder) },
        ),
      );
    }
    const { fields, deliveryFee: feeFor } = await prepare();

    let priced;
    try {
      priced = priceOrder(input.items, await this.loadPricingMenu(restaurant.id));
    } catch (error) {
      if (error instanceof OrderValidationError) {
        throw new ConflictException(apiError(error.code, error.message, { productId: error.productId }));
      }
      throw error;
    }
    const deliveryFee = feeFor?.(priced.subtotal) ?? 0;

    const day = businessDate(new Date(), restaurant.timezone);
    let created: OrderRecord;
    try {
      created = await this.connection.transaction(async (session) => {
        // Both counters and the insert share the transaction, so a failed insert never burns a number.
        const number = await this.counters.next(`order:${restaurant.id}`, session);
        const ticketNumber = await this.counters.next(`ticket:${restaurant.id}:${day}`, session);
        return this.orders.create(
          restaurant.id,
          {
            ...fields,
            number,
            ticketNumber,
            businessDate: day,
            items: priced.items,
            subtotal: priced.subtotal,
            deliveryFee,
            total: priced.subtotal + deliveryFee,
            currency: restaurant.currency,
            note: input.note?.trim() ?? "",
            accessTokenHash: hashToken(accessToken),
            clientOrderId: input.clientOrderId,
          },
          session,
        );
      });
    } catch (error) {
      // Two identical submissions raced past the lookup above: the unique index let only one in.
      if ((error as { code?: number }).code === DUPLICATE_KEY) {
        const winner = await this.orders.findByClientOrderId(restaurant.id, input.clientOrderId);
        if (winner) return { accessToken, order: this.publicView(winner, restaurant) };
      }
      throw error;
    }

    this.realtime.toRestaurant(restaurant.id).emit("order.created", toOrderView(created));
    return { accessToken, order: this.publicView(created, restaurant) };
  }

  /** @throws NotFoundException MENU_NOT_FOUND for unknown or suspended restaurants. */
  private async publicRestaurant(slug: string): Promise<RestaurantRecord> {
    const restaurant = await this.restaurants.findBySlug(slug.trim().toLowerCase());
    if (!restaurant || restaurant.status !== "active") throw menuNotFound();
    return restaurant;
  }

  /** Name, normalized phone and email of a pickup/delivery customer. @throws BadRequestException INVALID_PHONE. */
  private contact(input: CreatePickupOrderInput): Pick<ChannelFields, "customerName" | "customerPhone" | "customerEmail"> {
    const customerPhone = normalizePhone(input.customerPhone);
    if (!customerPhone) {
      throw new BadRequestException(apiError("INVALID_PHONE", "Revisa el teléfono, ej. +56 9 1234 5678"));
    }
    return {
      customerName: input.customerName.trim(),
      customerPhone,
      customerEmail: input.customerEmail?.trim().toLowerCase() ?? "",
    };
  }

  /** @throws HttpException 429 TOO_MANY_ACTIVE_ORDERS. */
  private async checkPhoneLimit(restaurantId: string, customerPhone: string): Promise<void> {
    const active = await this.orders.countActiveByPhone(restaurantId, customerPhone);
    if (active >= ORDER_LIMITS.activePickupOrdersPerPhone) {
      throw new HttpException(
        apiError(
          "TOO_MANY_ACTIVE_ORDERS",
          "Ya tienes varios pedidos en curso en este local. Espera a recibirlos antes de hacer otro.",
        ),
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Kitchen board ("active": still in progress) or the day's history ("today"). */
  async list(tenant: TenantContext, scope: "active" | "today"): Promise<OrderView[]> {
    if (scope === "active") return (await this.orders.listActive(tenant.restaurantId)).map(toOrderView);
    const restaurant = await this.restaurant(tenant.restaurantId);
    const day = businessDate(new Date(), restaurant.timezone);
    return (await this.orders.listByBusinessDate(tenant.restaurantId, day)).map(toOrderView);
  }

  /**
   * Sales summary of a business day (today in the restaurant's timezone by default).
   * @param date YYYY-MM-DD.
   */
  async dailySummary(tenant: TenantContext, date?: string): Promise<DailySummary> {
    const restaurant = await this.restaurant(tenant.restaurantId);
    const today = businessDate(new Date(), restaurant.timezone);
    const day = date ?? today;
    // The DTO checks the shape; here: a day that exists (no 2026-02-31) and has already started locally.
    if (!isCalendarDate(day)) {
      throw new BadRequestException(apiError("INVALID_DATE", "Esa fecha no existe; revisa el día y el mes"));
    }
    if (day > today) {
      throw new BadRequestException(apiError("FUTURE_DATE", "Aún no hay ventas para esa fecha"));
    }
    const orders = await this.orders.listByBusinessDate(tenant.restaurantId, day);
    return summarizeDay(orders, day, restaurant.currency);
  }

  async get(tenant: TenantContext, orderId: string): Promise<OrderView> {
    const order = await this.orders.findOne(tenant.restaurantId, orderId);
    if (!order) throw orderNotFound();
    return toOrderView(order);
  }

  /**
   * Moves an order through the state machine on behalf of a staff member.
   * @throws NotFoundException ORDER_NOT_FOUND; ConflictException INVALID_TRANSITION, ORDER_CHANGED;
   *   ForbiddenException FORBIDDEN_ROLE; BadRequestException REASON_REQUIRED.
   */
  async changeStatus(
    tenant: TenantContext,
    userId: string,
    orderId: string,
    to: OrderStatus,
    reason?: string,
    readyInMinutes?: number,
  ): Promise<OrderView> {
    const order = await this.orders.findOne(tenant.restaurantId, orderId);
    if (!order) throw orderNotFound();
    if (!isFloor(tenant.roles) && order.riderId !== userId) throw notYourDelivery();

    const check = checkTransition(order.channel, order.status, to, { kind: "staff", roles: tenant.roles });
    if (!check.ok && check.reason === "invalid_transition") {
      throw new ConflictException(apiError("INVALID_TRANSITION", "Ese cambio de estado no es posible ahora"));
    }
    if (!check.ok) throw new ForbiddenException(apiError("FORBIDDEN_ROLE", "Tu rol no permite esta acción"));
    if (check.requiresReason && !reason?.trim()) {
      throw new BadRequestException(apiError("REASON_REQUIRED", "Indica el motivo: el cliente lo verá"));
    }
    if (check.requiresReadyTime && !READY_MINUTES_BY_CHANNEL[order.channel]?.includes(readyInMinutes ?? -1)) {
      throw new BadRequestException(
        apiError(
          "READY_TIME_REQUIRED",
          order.channel === "delivery" ? "Indica en cuántos minutos llega" : "Indica en cuántos minutos estará listo",
        ),
      );
    }

    const user = await this.users.findById(userId);
    const updated = await this.orders.transition(tenant.restaurantId, orderId, order.status, {
      to,
      byUserId: userId,
      byName: user?.name ?? null,
      reason: reason?.trim() || null,
      ...(check.requiresReadyTime && readyInMinutes
        ? { estimatedReadyAt: new Date(Date.now() + readyInMinutes * 60_000) }
        : {}),
    });
    // Someone else moved the order between our read and our write.
    if (!updated) {
      throw new ConflictException(apiError("ORDER_CHANGED", "Alguien actualizó este pedido; revisa su estado"));
    }
    if (to === "accepted" && hasReceipt(updated)) await this.requestReceipt(updated);
    // Delivered (or otherwise left the road): the rider's position is not shared any more.
    if (order.status === "out_for_delivery") await this.tracking.clear(order.id);
    await this.broadcast(updated);
    return toOrderView(updated);
  }

  /** Staff download of an order's receipt. */
  async getReceipt(tenant: TenantContext, orderId: string): Promise<ReceiptResult> {
    const order = await this.orders.findOne(tenant.restaurantId, orderId);
    if (!order) throw orderNotFound();
    return this.readReceipt(order);
  }

  /** Customer download of their receipt, with the tracking token as the only key. */
  async getReceiptForCustomer(accessToken: string): Promise<ReceiptResult> {
    const order = await this.orders.findByAccessTokenHash(hashToken(accessToken));
    if (!order) throw orderNotFound();
    return this.readReceipt(order);
  }

  /**
   * @throws NotFoundException RECEIPT_NOT_FOUND when the order has no receipt (dine-in, never accepted);
   *   UnprocessableEntityException RECEIPT_FAILED when the workers gave up generating it.
   */
  private async readReceipt(order: OrderRecord): Promise<ReceiptResult> {
    if (!hasReceipt(order)) {
      throw new NotFoundException(apiError("RECEIPT_NOT_FOUND", "Este pedido no tiene comprobante"));
    }
    const pdf = await this.storage.getPrivate(receiptKey(order));
    if (!pdf) {
      if (await this.pdfQueue.receiptFailed(order.id)) {
        throw new UnprocessableEntityException(
          apiError("RECEIPT_FAILED", "No pudimos generar el comprobante; pídelo en el local"),
        );
      }
      // Accepted a moment ago: the workers are still generating it (they announce `order.receipt-ready`).
      return { status: "pending" };
    }
    return { status: "ready", pdf, filename: `comprobante-pedido-${order.number}.pdf` };
  }

  /**
   * Asks the workers for the PDF receipt and, when the customer left an email, the confirmation email.
   * The job carries the data to print (an immutable snapshot) and the tracking link, whose token is
   * re-derived from `clientOrderId`: only its hash is stored.
   */
  private async requestReceipt(order: OrderRecord): Promise<void> {
    const restaurant = await this.restaurant(order.restaurantId);
    const accessToken = deriveAccessToken(this.tokenSecret, restaurant.id, order.clientOrderId);
    await this.pdfQueue.enqueueReceipt({
      restaurantId: restaurant.id,
      orderId: order.id,
      outputKey: receiptKey(order),
      receipt: {
        restaurant: { name: restaurant.name, phone: restaurant.phone },
        number: order.number,
        ticketNumber: order.ticketNumber,
        channel: order.channel,
        createdAt: order.createdAt.toISOString(),
        estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
        timezone: restaurant.timezone,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        items: toOrderView(order).items,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        total: order.total,
        currency: order.currency,
        note: order.note,
        delivery: order.delivery ? { ...order.delivery } : null,
        expectedPayment: toExpectedPaymentView(order),
      },
      email: order.customerEmail
        ? { to: order.customerEmail, trackingUrl: `${this.appUrl}/pedido#t=${accessToken}` }
        : null,
    });
  }


  /**
   * Cash, card terminal or transfer. Independent of the order status. The cashier and the owner register any
   * payment; a rider only the ones of deliveries assigned to them (cash on delivery).
   * @throws NotFoundException ORDER_NOT_FOUND; ForbiddenException NOT_YOUR_DELIVERY.
   */
  async markPaid(tenant: TenantContext, userId: string, orderId: string, method: PaymentMethod): Promise<OrderView> {
    if (!tenant.roles.some((role) => role === "owner" || role === "cashier")) {
      const order = await this.orders.findOne(tenant.restaurantId, orderId);
      if (!order) throw orderNotFound();
      if (order.channel !== "delivery" || order.riderId !== userId) throw notYourDelivery();
    }
    const updated = await this.orders.markPaid(tenant.restaurantId, orderId, method);
    if (!updated) throw orderNotFound();
    this.realtime.toStaffOf(tenant.restaurantId, [updated.riderId]).emit("order.updated", toOrderView(updated));
    return toOrderView(updated);
  }

  /** Members with the rider role, for the assignment picker. */
  async listRiders(restaurantId: string): Promise<RiderView[]> {
    const riders = (await this.memberships.listByRestaurant(restaurantId)).filter((m) => m.roles.includes("rider"));
    const users = await this.users.findByIds(riders.map((m) => m.userId));
    return users.map((user) => ({ id: user.id, name: user.name })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  /**
   * Assigns a delivery to a rider (or unassigns it with null) while it is in progress.
   * @throws BadRequestException NOT_A_RIDER; NotFoundException ORDER_NOT_FOUND (also for finished orders and
   *   other channels).
   */
  async assignRider(tenant: TenantContext, orderId: string, riderId: string | null): Promise<OrderView> {
    let rider: { id: string; name: string } | null = null;
    if (riderId) {
      const membership = await this.memberships.findOne(tenant.restaurantId, riderId);
      const user = membership?.roles.includes("rider") ? await this.users.findById(riderId) : null;
      if (!user) throw new BadRequestException(apiError("NOT_A_RIDER", "Esa persona no es repartidor de este local"));
      rider = { id: user.id, name: user.name };
    }
    const previous = await this.orders.findOne(tenant.restaurantId, orderId);
    const updated = await this.orders.assignRider(tenant.restaurantId, orderId, rider);
    if (!updated) throw orderNotFound();
    // The previous rider gets the update too, so the order leaves their screen.
    await this.broadcast(updated, [previous?.riderId ?? null]);
    return toOrderView(updated);
  }

  /** A rider's screen: their deliveries in progress. */
  async listForRider(tenant: TenantContext, userId: string): Promise<OrderView[]> {
    return (await this.orders.listActiveForRider(tenant.restaurantId, userId)).map(toOrderView);
  }

  /** Tracking page. The access token is the only key: no account and no order number lookups. */
  async findForCustomer(accessToken: string): Promise<PublicOrderView> {
    const order = await this.orders.findByAccessTokenHash(hashToken(accessToken));
    if (!order) throw orderNotFound();
    return this.publicView(order, await this.restaurant(order.restaurantId));
  }

  /** The rider's last position for the customer, only while the delivery is on its way. */
  async riderPositionForCustomer(accessToken: string): Promise<RiderPosition | null> {
    const order = await this.orders.findByAccessTokenHash(hashToken(accessToken));
    if (!order) throw orderNotFound();
    return order.status === "out_for_delivery" ? this.tracking.lastPosition(order.id) : null;
  }

  /** The rider's last position for the staff board. */
  async riderPosition(tenant: TenantContext, orderId: string): Promise<RiderPosition | null> {
    const order = await this.orders.findOne(tenant.restaurantId, orderId);
    if (!order) throw orderNotFound();
    return order.status === "out_for_delivery" ? this.tracking.lastPosition(order.id) : null;
  }

  /** @returns The order record behind a tracking token (Socket.IO subscriptions), or null. */
  async findRecordByAccessToken(accessToken: string): Promise<OrderRecord | null> {
    return this.orders.findByAccessTokenHash(hashToken(accessToken));
  }

  /**
   * The customer cancels their own order, only while nobody has accepted it yet.
   * @throws NotFoundException ORDER_NOT_FOUND; ConflictException ORDER_NOT_CANCELLABLE.
   */
  async cancelByCustomer(accessToken: string): Promise<PublicOrderView> {
    const order = await this.orders.findByAccessTokenHash(hashToken(accessToken));
    if (!order) throw orderNotFound();
    const notCancellable = () =>
      new ConflictException(
        apiError("ORDER_NOT_CANCELLABLE", "El local ya tomó tu pedido; pide ayuda al personal para cambiarlo"),
      );
    if (!checkTransition(order.channel, order.status, "cancelled", { kind: "customer" }).ok) throw notCancellable();

    const updated = await this.orders.transition(order.restaurantId, order.id, order.status, {
      to: "cancelled",
      byUserId: null,
      byName: null,
      reason: "Cancelado por el cliente",
    });
    if (!updated) throw notCancellable();
    await this.broadcast(updated);
    return this.publicView(updated, await this.restaurant(updated.restaurantId));
  }

  /**
   * Staff board (and the assigned rider) get the full view; the customer's tracking page gets the public one.
   * @param otherRiders Riders who must also hear about it (one just unassigned).
   */
  private async broadcast(order: OrderRecord, otherRiders: (string | null)[] = []): Promise<void> {
    this.realtime
      .toStaffOf(order.restaurantId, [order.riderId, ...otherRiders])
      .emit("order.updated", toOrderView(order));
    const restaurant = await this.restaurant(order.restaurantId);
    this.realtime.toOrder(order.id).emit("order.status", this.publicView(order, restaurant));
  }

  private publicView(order: OrderRecord, restaurant: RestaurantRecord): PublicOrderView {
    return toPublicOrderView(order, { name: restaurant.name, slug: restaurant.slug, phone: restaurant.phone });
  }

  private async restaurant(id: string): Promise<RestaurantRecord> {
    const restaurant = await this.restaurants.findById(id);
    if (!restaurant) throw orderNotFound();
    return restaurant;
  }

  /** Whole menu of the restaurant (small) in the shape the pricing needs. */
  private async loadPricingMenu(restaurantId: string): Promise<PricingMenu> {
    const [categories, products, groups] = await Promise.all([
      this.categories.list(restaurantId, { activeOnly: true }),
      this.products.list(restaurantId),
      this.modifierGroups.list(restaurantId),
    ]);
    const activeCategories = new Set(categories.map((c) => c.id));
    return {
      products: new Map(
        products.map((p) => [
          p.id,
          {
            id: p.id,
            name: p.name,
            price: p.price,
            available: p.available,
            orderable: p.visible && activeCategories.has(p.categoryId),
            modifierGroupIds: p.modifierGroupIds,
          },
        ]),
      ),
      groups: new Map(groups.map((g) => [g.id, g])),
    };
  }
}
