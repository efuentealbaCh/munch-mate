import type { ClientToServerEvents, ServerToClientEvents, SubscribeResult } from "@app/types";
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { AccessTokenService } from "../auth/access-token.service";
import { ACCESS_COOKIE } from "../auth/auth.constants";
import type { AuthUser } from "../auth/auth.types";
import { orderRoom, RealtimeService, restaurantRoom } from "../realtime/realtime.service";
import { MembershipsRepository } from "../restaurants/memberships.repository";
import { OrdersService } from "./orders.service";

interface SocketData {
  user: AuthUser | null;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Reads one cookie from the raw Cookie header of the WebSocket handshake. */
function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

/**
 * Real-time channel (served at /socket.io, same origin as the app).
 * - Staff authenticate with the same httpOnly cookie as the REST api (no token in JS) and subscribe to a
 *   restaurant they belong to.
 * - Customers are anonymous and subscribe to one order with its tracking token.
 * Foreign origins are rejected during the handshake by RedisIoAdapter.
 */
@WebSocketGateway()
export class OrdersGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly accessTokens: AccessTokenService,
    private readonly memberships: MembershipsRepository,
    private readonly orders: OrdersService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
  }

  /** Identifies staff from the session cookie; anonymous sockets are fine (customers). */
  async handleConnection(socket: AppSocket): Promise<void> {
    const token = readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE);
    socket.data.user = token ? await this.accessTokens.verify(token) : null;
  }

  /** Same isolation rule as the REST api: only members get a restaurant's events. */
  @SubscribeMessage("restaurant.subscribe")
  async subscribeRestaurant(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() restaurantId: unknown,
  ): Promise<SubscribeResult> {
    const user = socket.data.user;
    if (!user) return { ok: false, code: "UNAUTHENTICATED" };
    if (typeof restaurantId !== "string" || !(await this.memberships.findOne(restaurantId, user.id))) {
      return { ok: false, code: "RESTAURANT_NOT_FOUND" };
    }
    await socket.join(restaurantRoom(restaurantId));
    return { ok: true };
  }

  @SubscribeMessage("order.subscribe")
  async subscribeOrder(@ConnectedSocket() socket: AppSocket, @MessageBody() accessToken: unknown): Promise<SubscribeResult> {
    const order = typeof accessToken === "string" ? await this.orders.findRecordByAccessToken(accessToken) : null;
    if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
    await socket.join(orderRoom(order.id));
    return { ok: true };
  }
}
