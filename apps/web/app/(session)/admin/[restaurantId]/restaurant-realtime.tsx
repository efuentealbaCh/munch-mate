"use client";

import { createContext, type ReactNode, useContext, useMemo, useRef, useState } from "react";
import { type RealtimeStatus, subscribeWithTimeout, useRealtime, useSocketEvent } from "@/hooks/use-realtime";
import { useAuth } from "@/lib/auth-context";
import type { AppSocket } from "@/lib/realtime";

export interface RestaurantRealtimeValue {
  socket: AppSocket | null;
  status: RealtimeStatus;
  /**
   * Increments after every successful subscription (first connect and every reconnect). Pages that show
   * live data refetch when it changes: events emitted while disconnected are not replayed.
   */
  syncCount: number;
}

const RestaurantRealtimeContext = createContext<RestaurantRealtimeValue | null>(null);

/**
 * One Socket.IO connection per restaurant page tree, subscribed to the restaurant's room. The staff member
 * is identified by the session cookie sent with the handshake (no token in JS). When the access cookie has
 * expired the subscription answers UNAUTHENTICATED: the session is refreshed through the regular api client
 * and a new handshake picks up the new cookie; if the session is gone, the admin shell redirects to login.
 */
export function RestaurantRealtimeProvider({
  restaurantId,
  onAccepting,
  onResync,
  children,
}: {
  restaurantId: string;
  /** `restaurant.accepting` from any device (another phone opened or closed the restaurant). */
  onAccepting(acceptingOrders: boolean): void;
  /** After a REconnect (not the first one): reload what this provider's owner shows. */
  onResync(): void;
  children: ReactNode;
}) {
  const { syncSession } = useAuth();
  const [syncCount, setSyncCount] = useState(0);
  const subscribedOnce = useRef(false);

  const { socket, status } = useRealtime(`restaurant:${restaurantId}`, {
    enabled: true,
    subscribe: (s) => subscribeWithTimeout(s, "restaurant.subscribe", restaurantId),
    onSubscribed: () => {
      setSyncCount((n) => n + 1);
      if (subscribedOnce.current) onResync();
      subscribedOnce.current = true;
    },
    onUnauthenticated: async () => (await syncSession()) !== null,
  });

  useSocketEvent(socket, "restaurant.accepting", (payload) => {
    if (payload.restaurantId === restaurantId) onAccepting(payload.acceptingOrders);
  });

  const value = useMemo(() => ({ socket, status, syncCount }), [socket, status, syncCount]);
  return <RestaurantRealtimeContext.Provider value={value}>{children}</RestaurantRealtimeContext.Provider>;
}

/** Live connection of the current restaurant. @throws Error outside the restaurant layout. */
export function useRestaurantRealtime(): RestaurantRealtimeValue {
  const context = useContext(RestaurantRealtimeContext);
  if (!context) throw new Error("useRestaurantRealtime must be used inside the restaurant layout");
  return context;
}
