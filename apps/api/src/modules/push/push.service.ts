import { ORDER_CHANNEL_LABELS, type PushConfig, type PushNotification, type PushSubscriptionInput } from "@app/types";
import { formatMoney, isPushEndpointAllowed } from "@app/utils";
import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { apiError } from "../../common/errors/api-error";
import type { ApiEnv } from "../../config/env.validation";
import { NotifQueue } from "../../infra/queue/notif.queue";
import { MembershipsRepository } from "../restaurants/memberships.repository";
import { type PushTarget, PushSubscriptionsRepository } from "./push-subscriptions.repository";

/** How long a guest keeps following an order after subscribing. */
const ORDER_FOLLOW_HOURS = 12;
/** Who hears about new orders: the people who work the board (not riders). */
const BOARD_ROLES = new Set(["owner", "cashier", "kitchen"]);

/** The minimum an order needs to be announced (kept independent from the orders module). */
export interface NotifiableOrder {
  id: string;
  restaurantId: string;
  ticketNumber: number;
  channel: keyof typeof ORDER_CHANNEL_LABELS;
  tableLabel: string | null;
  total: number;
  currency: string;
}

/**
 * Web push: stores subscriptions and turns order events into notification jobs. Failures never break the
 * order flow (logged and skipped): a notification is a courtesy, the board and tracking page are the truth.
 */
@Injectable()
export class PushService {
  private readonly publicKey: string | null;

  constructor(
    private readonly subscriptions: PushSubscriptionsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly queue: NotifQueue,
    @InjectPinoLogger(PushService.name) private readonly logger: PinoLogger,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.publicKey = config.get("VAPID_PUBLIC_KEY", { infer: true }) ?? null;
  }

  config(): PushConfig {
    return { publicKey: this.publicKey };
  }

  /** @throws BadRequestException PUSH_NOT_CONFIGURED, INVALID_PUSH_ENDPOINT. */
  async subscribeUser(userId: string, subscription: PushSubscriptionInput): Promise<void> {
    this.assertSubscribable(subscription);
    await this.subscriptions.saveForUser(userId, subscription);
  }

  async unsubscribeUser(userId: string, endpoint: string): Promise<void> {
    await this.subscriptions.deleteForUser(userId, endpoint);
  }

  /** A customer (guest or not) follows one order; the subscription expires on its own. */
  async followOrder(orderId: string, subscription: PushSubscriptionInput): Promise<void> {
    this.assertSubscribable(subscription);
    await this.subscriptions.saveForOrder(orderId, subscription, new Date(Date.now() + ORDER_FOLLOW_HOURS * 3_600_000));
  }

  /** New order: everyone who works the board of that restaurant, on every device they enabled. */
  async newOrder(order: NotifiableOrder): Promise<void> {
    await this.safely(order.id, async () => {
      const members = await this.memberships.listByRestaurant(order.restaurantId);
      const userIds = members.filter((m) => m.roles.some((role) => BOARD_ROLES.has(role))).map((m) => m.userId);
      const where = order.tableLabel ?? ORDER_CHANNEL_LABELS[order.channel];
      await this.send(
        await this.subscriptions.listForUsers(userIds),
        {
          title: `Pedido nuevo #${order.ticketNumber}`,
          body: `${where} · ${formatMoney(order.total, order.currency)}`,
          url: `/admin/${order.restaurantId}/pedidos`,
          tag: `order-${order.id}`,
        },
        `push-created-${order.id}`,
      );
    });
  }

  /** The customer's order is ready to pick up, or on its way. */
  async customerUpdate(order: NotifiableOrder, event: "ready" | "on_the_way", trackingUrl: string): Promise<void> {
    await this.safely(order.id, async () => {
      await this.send(
        await this.subscriptions.listForOrder(order.id),
        event === "ready"
          ? {
              title: `Tu pedido #${order.ticketNumber} está listo`,
              body: "Ya puedes retirarlo en el local.",
              url: trackingUrl,
              tag: `track-${order.id}`,
            }
          : {
              title: `Tu pedido #${order.ticketNumber} va en camino`,
              body: "Puedes seguir al repartidor en el mapa.",
              url: trackingUrl,
              tag: `track-${order.id}`,
            },
        `push-${event}-${order.id}`,
      );
    });
  }

  /** A delivery was assigned to a rider. */
  async riderAssigned(order: NotifiableOrder, riderId: string): Promise<void> {
    await this.safely(order.id, async () => {
      await this.send(
        await this.subscriptions.listForUsers([riderId]),
        {
          title: `Te asignaron el pedido #${order.ticketNumber}`,
          body: "Revisa la dirección en Repartos.",
          url: `/admin/${order.restaurantId}/repartos`,
          tag: `delivery-${order.id}`,
        },
        `push-rider-${order.id}-${riderId}`,
      );
    });
  }

  private assertSubscribable(subscription: PushSubscriptionInput): void {
    if (!this.publicKey) {
      throw new BadRequestException(apiError("PUSH_NOT_CONFIGURED", "Las notificaciones no están activas en este servidor"));
    }
    if (!isPushEndpointAllowed(subscription.endpoint)) {
      throw new BadRequestException(apiError("INVALID_PUSH_ENDPOINT", "Este navegador no es compatible con las notificaciones"));
    }
  }

  private async send(targets: PushTarget[], notification: PushNotification, jobId: string): Promise<void> {
    if (!this.publicKey || targets.length === 0) return;
    await this.queue.push({ subscriptions: targets, notification }, jobId);
  }

  private async safely(orderId: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn({ orderId, err: error }, "push notification skipped");
    }
  }
}
