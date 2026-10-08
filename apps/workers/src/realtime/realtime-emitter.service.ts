import type { ServerToClientEvents } from "@app/types";
import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Emitter } from "@socket.io/redis-emitter";
import { Redis } from "ioredis";
import type { WorkersEnv } from "../config/env.validation";

/**
 * Emits Socket.IO events from the workers without importing the api: messages go through Valkey and the
 * api's Redis adapter delivers them to the connected clients. Room names match the api's.
 */
@Injectable()
export class RealtimeEmitterService implements OnApplicationShutdown {
  private readonly client: Redis;
  private readonly emitter: Emitter<ServerToClientEvents>;

  constructor(config: ConfigService<WorkersEnv, true>) {
    this.client = new Redis(config.get("VALKEY_URL", { infer: true }), { connectionName: "workers-emitter" });
    this.emitter = new Emitter<ServerToClientEvents>(this.client);
  }

  toRestaurant(restaurantId: string) {
    return this.emitter.to(`restaurant:${restaurantId}`);
  }

  /** The staff board and the customer tracking that order. */
  toRestaurantAndOrder(restaurantId: string, orderId: string) {
    return this.emitter.to([`restaurant:${restaurantId}`, `order:${orderId}`]);
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
