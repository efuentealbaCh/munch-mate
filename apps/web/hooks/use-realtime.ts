"use client";

import type { ServerToClientEvents, SubscribeResult } from "@app/types";
import { useEffect, useRef, useState } from "react";
import { type AppSocket, createSocket, SUBSCRIBE_TIMEOUT_MS } from "@/lib/realtime";

/**
 * - connecting: first connection (or a new handshake after refreshing the session) in progress.
 * - live: connected and subscribed; events are flowing.
 * - offline: disconnected; socket.io keeps retrying on its own.
 * - denied: the server refused the subscription (unknown order, not a member, session gone).
 */
export type RealtimeStatus = "connecting" | "live" | "offline" | "denied";

export interface RealtimeOptions {
  /** False keeps the socket closed (e.g. while there is no token yet). */
  enabled: boolean;
  /** Joins the room. Runs on every (re)connect: a new connection starts without rooms. */
  subscribe(socket: AppSocket): Promise<SubscribeResult>;
  /**
   * Runs after every successful subscribe. Refetch over REST here: events emitted while disconnected are
   * not replayed, so only a fresh read guarantees nothing was missed.
   */
  onSubscribed?(): void;
  /**
   * Called when the subscribe ack says UNAUTHENTICATED (staff session cookie expired: the server reads it
   * only at handshake). Refresh the session and resolve true to retry with a new handshake.
   */
  onUnauthenticated?(): Promise<boolean>;
  /** Final refusal (code from the ack). */
  onDenied?(code: string): void;
}

/** Delay before a new handshake when a subscribe ack never arrived. */
const RETRY_DELAY_MS = 3_000;

/**
 * One Socket.IO connection for the lifetime of the component, with subscribe-on-every-connect, refetch
 * hooks and the expired-session dance. Attach listeners with {@link useSocketEvent}.
 * @param key Changing it (restaurant id, access token) closes the socket and opens a new one.
 */
export function useRealtime(key: string, options: RealtimeOptions): { socket: AppSocket | null; status: RealtimeStatus } {
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  // Latest callbacks without reconnecting when the caller re-renders.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const { enabled } = options;

  useEffect(() => {
    if (!enabled) return;
    const client = createSocket();
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // One session refresh per failure streak: if the fresh cookie is refused too, stop instead of looping.
    let refreshedOnce = false;

    const reconnectSoon = () => {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (!disposed) client.disconnect().connect();
      }, RETRY_DELAY_MS);
    };

    async function handleConnect() {
      let result: SubscribeResult;
      try {
        result = await optionsRef.current.subscribe(client);
      } catch {
        // No ack within the timeout: the connection is not usable. Start over with a new handshake.
        if (disposed) return;
        setStatus("offline");
        reconnectSoon();
        return;
      }
      if (disposed) return;
      if (result.ok) {
        refreshedOnce = false;
        setStatus("live");
        optionsRef.current.onSubscribed?.();
        return;
      }
      if (result.code === "UNAUTHENTICATED" && !refreshedOnce && optionsRef.current.onUnauthenticated) {
        refreshedOnce = true;
        setStatus("connecting");
        const refreshed = await optionsRef.current.onUnauthenticated().catch(() => false);
        if (disposed) return;
        // A new handshake is the only way for the server to read the new cookie.
        if (refreshed) client.disconnect().connect();
        else reconnectSoon();
        return;
      }
      setStatus("denied");
      optionsRef.current.onDenied?.(result.code);
      client.disconnect();
    }

    client.on("connect", () => void handleConnect());
    client.on("disconnect", (reason) => {
      if (disposed) return;
      setStatus((current) => (current === "denied" ? current : "offline"));
      // The server closed it on purpose (e.g. restart): socket.io does not reconnect by itself in that case.
      if (reason === "io server disconnect") reconnectSoon();
    });
    client.on("connect_error", () => {
      if (!disposed) setStatus((current) => (current === "denied" ? current : "offline"));
    });

    setStatus("connecting");
    setSocket(client);
    client.connect();
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      client.removeAllListeners();
      client.disconnect();
      setSocket(null);
    };
  }, [key, enabled]);

  return { socket, status };
}

/** Helper for subscribe callbacks: emits with a timeout so a silent server cannot hang the hook. */
export function subscribeWithTimeout(
  socket: AppSocket,
  event: "restaurant.subscribe" | "order.subscribe",
  argument: string,
): Promise<SubscribeResult> {
  return socket.timeout(SUBSCRIBE_TIMEOUT_MS).emitWithAck(event, argument);
}

/**
 * Listens to one server event while the component is mounted. The handler may change on every render.
 */
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  socket: AppSocket | null,
  event: E,
  handler: ServerToClientEvents[E],
): void {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!socket) return;
    const listener = ((...args: Parameters<ServerToClientEvents[E]>) =>
      (handlerRef.current as (...a: Parameters<ServerToClientEvents[E]>) => void)(...args)) as ServerToClientEvents[E];
    // socket.io's typed overloads do not narrow well with a generic event name.
    (socket as unknown as { on(e: string, l: unknown): void }).on(event, listener);
    return () => {
      (socket as unknown as { off(e: string, l: unknown): void }).off(event, listener);
    };
  }, [socket, event]);
}

/** Runs `callback` when the tab becomes visible again (phones suspend background tabs and their sockets). */
export function useOnVisible(callback: () => void): void {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  });
  useEffect(() => {
    const listener = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, []);
}
