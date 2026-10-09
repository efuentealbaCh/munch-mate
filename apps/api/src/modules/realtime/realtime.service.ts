import type { ClientToServerEvents, ServerToClientEvents } from "@app/types";
import { Injectable } from "@nestjs/common";
import type { Server } from "socket.io";

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Typed emitter bound to one room. */
export interface RoomEmitter {
  emit<E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
}

export const restaurantRoom = (restaurantId: string) => `restaurant:${restaurantId}`;
export const orderRoom = (orderId: string) => `order:${orderId}`;
/** A rider-only member: receives just the deliveries assigned to them (customer data of other orders stays out). */
export const riderRoom = (restaurantId: string, userId: string) => `rider:${restaurantId}:${userId}`;

/**
 * Emits events to Socket.IO rooms from anywhere in the api. The gateway attaches the server once it starts;
 * through the Redis adapter, emissions reach clients connected to any api replica.
 */
@Injectable()
export class RealtimeService {
  private server?: RealtimeServer;

  attach(server: RealtimeServer): void {
    this.server = server;
  }

  /** Staff of a restaurant (kitchen board, cashier). */
  toRestaurant(restaurantId: string): RoomEmitter {
    return this.room(restaurantRoom(restaurantId));
  }

  /**
   * Staff updates of one order: the restaurant room plus the rooms of the given riders (the assigned one, and
   * the previous one when it changes, so their screen drops it). Socket.IO delivers once per socket.
   */
  toStaffOf(restaurantId: string, riderIds: readonly (string | null)[]): RoomEmitter {
    const rooms = [
      restaurantRoom(restaurantId),
      ...new Set(riderIds.filter((id): id is string => id !== null).map((id) => riderRoom(restaurantId, id))),
    ];
    return {
      emit: (event, ...args) => {
        this.server?.to(rooms).emit(event, ...args);
      },
    };
  }

  /** The customer tracking one order. */
  toOrder(orderId: string): RoomEmitter {
    return this.room(orderRoom(orderId));
  }

  private room(name: string): RoomEmitter {
    return {
      emit: (event, ...args) => {
        // Before the gateway starts (unit tests, standalone scripts) emissions are dropped instead of failing.
        this.server?.to(name).emit(event, ...args);
      },
    };
  }
}
