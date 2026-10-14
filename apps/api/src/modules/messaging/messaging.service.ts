import type { MessageChannel, OrderMessageEvent } from "@app/types";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { ApiEnv } from "../../config/env.validation";
import { NotifQueue } from "../../infra/queue/notif.queue";
import type { RestaurantRecord } from "../restaurants/restaurants.repository";
import { type MessageOrderFacts, orderMessage } from "./order-messages";

/** The minimum an order needs to be messaged about. */
export interface MessageableOrder {
  id: string;
  restaurantId: string;
  customerPhone: string;
  notifyBy: MessageChannel | null;
}

/**
 * WhatsApp/SMS order notices (phase 8). The restaurant offers them (owner setting with its sender number),
 * the customer asks for them at checkout, the workers send them through the platform's provider. Like push,
 * a notice never breaks the order flow: failures to enqueue are logged and skipped.
 */
@Injectable()
export class MessagingService {
  /** Whether the platform has a provider configured. */
  readonly available: boolean;

  constructor(
    private readonly queue: NotifQueue,
    @InjectPinoLogger(MessagingService.name) private readonly logger: PinoLogger,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.available = config.get("MESSAGING_PROVIDER", { infer: true }) !== "off";
  }

  /** The channel a restaurant offers its customers right now, or null when it offers none. */
  offeredChannel(restaurant: Pick<RestaurantRecord, "messaging">): MessageChannel | null {
    const { messaging } = restaurant;
    return this.available && messaging.enabled && messaging.senderPhone ? messaging.channel : null;
  }

  /** Queues the notice of an order event, when the customer asked for notices and the restaurant still sends them. */
  async orderEvent(
    order: MessageableOrder,
    restaurant: Pick<RestaurantRecord, "messaging">,
    event: OrderMessageEvent,
    facts: MessageOrderFacts,
  ): Promise<void> {
    if (!order.notifyBy || !order.customerPhone || !this.offeredChannel(restaurant)) return;
    try {
      await this.queue.message({
        restaurantId: order.restaurantId,
        orderId: order.id,
        event,
        // The channel the customer accepted when ordering, from the restaurant's current number.
        channel: order.notifyBy,
        from: restaurant.messaging.senderPhone,
        to: order.customerPhone,
        text: orderMessage(event, facts),
      });
    } catch (error) {
      this.logger.warn({ err: error, orderId: order.id, event }, "could not enqueue the order message");
    }
  }
}
