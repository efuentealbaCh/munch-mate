import type {
  CreateDineInOrderInput,
  CreatedOrder,
  OrderStatus,
  OrderView,
  PaymentMethod,
  PublicOrderView,
} from "@app/types";
import { checkTransition } from "@app/utils";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectConnection } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { hashToken } from "../../common/crypto/tokens";
import { apiError } from "../../common/errors/api-error";
import type { ApiEnv } from "../../config/env.validation";
import { CategoriesRepository } from "../menu/categories.repository";
import { ModifierGroupsRepository } from "../menu/modifier-groups.repository";
import { ProductsRepository } from "../menu/products.repository";
import { RealtimeService } from "../realtime/realtime.service";
import type { TenantContext } from "../restaurants/restaurant-access.guard";
import { type RestaurantRecord, RestaurantsRepository } from "../restaurants/restaurants.repository";
import { UsersRepository } from "../users/users.repository";
import { OrderValidationError, type PricingMenu, priceOrder } from "./order-pricing";
import { businessDate, deriveAccessToken } from "./order-tokens";
import { toOrderView, toPublicOrderView } from "./order.views";
import { CountersRepository } from "./counters.repository";
import { DUPLICATE_KEY, type OrderRecord, OrdersRepository } from "./orders.repository";
import { TablesRepository } from "./tables.repository";

const orderNotFound = () => new NotFoundException(apiError("ORDER_NOT_FOUND", "No encontramos ese pedido"));
const tableNotFound = () =>
  new NotFoundException(apiError("TABLE_NOT_FOUND", "Este código QR no está activo. Pide ayuda al personal."));

@Injectable()
export class OrdersService {
  private readonly tokenSecret: string;

  constructor(
    private readonly orders: OrdersRepository,
    private readonly counters: CountersRepository,
    private readonly tables: TablesRepository,
    private readonly restaurants: RestaurantsRepository,
    private readonly categories: CategoriesRepository,
    private readonly products: ProductsRepository,
    private readonly modifierGroups: ModifierGroupsRepository,
    private readonly users: UsersRepository,
    private readonly realtime: RealtimeService,
    @InjectConnection() private readonly connection: Connection,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.tokenSecret = config.get("ORDER_TOKEN_SECRET", { infer: true });
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

    const accessToken = deriveAccessToken(this.tokenSecret, restaurant.id, input.clientOrderId);
    const existing = await this.orders.findByClientOrderId(restaurant.id, input.clientOrderId);
    if (existing) return { accessToken, order: this.publicView(existing, restaurant) };

    if (!restaurant.acceptingOrders) {
      throw new ConflictException(
        apiError("NOT_ACCEPTING_ORDERS", "El local no está recibiendo pedidos en este momento"),
      );
    }

    let priced;
    try {
      priced = priceOrder(input.items, await this.loadPricingMenu(restaurant.id));
    } catch (error) {
      if (error instanceof OrderValidationError) {
        throw new ConflictException(apiError(error.code, error.message, { productId: error.productId }));
      }
      throw error;
    }

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
            number,
            ticketNumber,
            businessDate: day,
            channel: "dine_in",
            items: priced.items,
            subtotal: priced.subtotal,
            total: priced.subtotal,
            currency: restaurant.currency,
            customerName: input.customerName?.trim() ?? "",
            note: input.note?.trim() ?? "",
            tableId: table.id,
            tableLabel: table.label,
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

  /** Kitchen board ("active": still in progress) or the day's history ("today"). */
  async list(tenant: TenantContext, scope: "active" | "today"): Promise<OrderView[]> {
    if (scope === "active") return (await this.orders.listActive(tenant.restaurantId)).map(toOrderView);
    const restaurant = await this.restaurant(tenant.restaurantId);
    const day = businessDate(new Date(), restaurant.timezone);
    return (await this.orders.listByBusinessDate(tenant.restaurantId, day)).map(toOrderView);
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
  ): Promise<OrderView> {
    const order = await this.orders.findOne(tenant.restaurantId, orderId);
    if (!order) throw orderNotFound();

    const check = checkTransition(order.channel, order.status, to, { kind: "staff", roles: tenant.roles });
    if (!check.ok && check.reason === "invalid_transition") {
      throw new ConflictException(apiError("INVALID_TRANSITION", "Ese cambio de estado no es posible ahora"));
    }
    if (!check.ok) throw new ForbiddenException(apiError("FORBIDDEN_ROLE", "Tu rol no permite esta acción"));
    if (check.requiresReason && !reason?.trim()) {
      throw new BadRequestException(apiError("REASON_REQUIRED", "Indica el motivo: el cliente lo verá"));
    }

    const user = await this.users.findById(userId);
    const updated = await this.orders.transition(tenant.restaurantId, orderId, order.status, {
      to,
      byUserId: userId,
      byName: user?.name ?? null,
      reason: reason?.trim() || null,
    });
    // Someone else moved the order between our read and our write.
    if (!updated) {
      throw new ConflictException(apiError("ORDER_CHANGED", "Alguien actualizó este pedido; revisa su estado"));
    }
    await this.broadcast(updated);
    return toOrderView(updated);
  }

  /** Cash, card terminal or transfer, registered by the cashier. Independent of the order status. */
  async markPaid(tenant: TenantContext, orderId: string, method: PaymentMethod): Promise<OrderView> {
    const updated = await this.orders.markPaid(tenant.restaurantId, orderId, method);
    if (!updated) throw orderNotFound();
    this.realtime.toRestaurant(tenant.restaurantId).emit("order.updated", toOrderView(updated));
    return toOrderView(updated);
  }

  /** Tracking page. The access token is the only key: no account and no order number lookups. */
  async findForCustomer(accessToken: string): Promise<PublicOrderView> {
    const order = await this.orders.findByAccessTokenHash(hashToken(accessToken));
    if (!order) throw orderNotFound();
    return this.publicView(order, await this.restaurant(order.restaurantId));
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

  /** Staff board gets the full view; the customer's tracking page gets the public one. */
  private async broadcast(order: OrderRecord): Promise<void> {
    this.realtime.toRestaurant(order.restaurantId).emit("order.updated", toOrderView(order));
    const restaurant = await this.restaurant(order.restaurantId);
    this.realtime.toOrder(order.id).emit("order.status", this.publicView(order, restaurant));
  }

  private publicView(order: OrderRecord, restaurant: RestaurantRecord): PublicOrderView {
    return toPublicOrderView(order, { name: restaurant.name, slug: restaurant.slug });
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
