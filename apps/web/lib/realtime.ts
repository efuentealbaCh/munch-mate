import type { ClientToServerEvents, ServerToClientEvents } from "@app/types";
import { io, type Socket } from "socket.io-client";

/** Typed Socket.IO client (event names and payloads shared with the api through @app/types). */
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** How long to wait for a subscribe acknowledgement before treating the connection as broken. */
export const SUBSCRIBE_TIMEOUT_MS = 10_000;

/**
 * Creates a (not yet connected) socket to the same origin, path /socket.io.
 * - Staff are identified by the httpOnly session cookie the browser sends with the handshake: no token is
 *   ever handled in JS.
 * - Default transports (polling first, then upgrade to WebSocket): in `pnpm dev` the upgrade does not go
 *   through the Next rewrite and the client simply keeps polling.
 * - In dev the path has no trailing slash: Next would answer "/socket.io/" with a 308 (see next.config.ts).
 */
export function createSocket(): AppSocket {
  return io({
    path: "/socket.io",
    addTrailingSlash: process.env.NODE_ENV !== "development",
    withCredentials: true,
    autoConnect: false,
  });
}
