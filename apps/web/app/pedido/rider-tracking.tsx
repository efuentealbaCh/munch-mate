"use client";

import type { OrderDeliveryView, RiderPosition } from "@app/types";
import { BikeIcon, CircleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TrackingMap } from "@/components/map";
import { useMapConfig } from "@/hooks/use-map-config";
import { useNow } from "@/hooks/use-now";
import { type RealtimeStatus, useOnVisible, useSocketEvent } from "@/hooks/use-realtime";
import { publicOrdersApi } from "@/lib/endpoints";
import { formatAgo, isStalePosition, type TrackedPosition, trackPosition } from "@/lib/maps";
import type { AppSocket } from "@/lib/realtime";

/** Keeps the newest report: the REST read and a live event can arrive in any order. */
function newest(current: TrackedPosition | null, incoming: TrackedPosition): TrackedPosition {
  return current && current.at > incoming.at ? current : incoming;
}

/**
 * The rider on the map while a delivery is "En reparto" (phase 7): the last position on load
 * (`rider-location`, token in the body) and then live `order.rider-location` events. Renders nothing
 * without the base map: the tracking page stays as it was.
 */
export function RiderTracking({
  token,
  socket,
  live,
  delivery,
  riderName,
}: {
  token: string;
  socket: AppSocket | null;
  live: RealtimeStatus;
  delivery: OrderDeliveryView;
  riderName: string | null;
}) {
  const map = useMapConfig();
  const now = useNow(5_000);
  const [position, setPosition] = useState<TrackedPosition | null>(null);

  const load = useCallback(async () => {
    try {
      const { position: last } = await publicOrdersApi.riderLocation(token);
      // null = no report yet: keep what a live event may already have brought.
      if (last) setPosition((current) => newest(current, trackPosition(last, Date.now(), false)));
    } catch {
      // The map is an extra: the next live event (or the next visit) fills it in.
    }
  }, [token]);

  // On load and after every (re)subscription: events missed while offline are not replayed.
  const isLive = live === "live";
  useEffect(() => {
    if (map.available) void load();
  }, [map.available, isLive, load]);
  useOnVisible(() => {
    if (map.available) void load();
  });
  // The customer's socket is only in this order's room: every event is about this delivery.
  useSocketEvent(socket, "order.rider-location", (payload: RiderPosition & { orderId: string }) =>
    setPosition((current) => newest(current, trackPosition(payload, Date.now(), true))),
  );

  if (!map.available || !map.config) return null;
  const rider = riderName ?? "El repartidor";
  const point = position ? { lat: position.lat, lng: position.lng } : null;
  const stale = position !== null && now > 0 && isStalePosition(position, now);

  return (
    <section aria-labelledby="seguimiento" className="flex flex-col gap-2" data-testid="rider-tracking">
      <h2 id="seguimiento" className="sr-only">
        Seguimiento del repartidor
      </h2>
      {delivery.location || point ? (
        <div className="h-64 w-full">
          <TrackingMap
            config={map.config}
            destination={delivery.location}
            rider={point}
            riderLabel={rider}
            label="Mapa con el repartidor y tu dirección"
          />
        </div>
      ) : null}
      <div aria-live="polite" className="text-sm">
        {!position ? (
          <p className="flex items-center gap-2 text-muted-foreground" data-testid="rider-waiting">
            <BikeIcon className="size-4 shrink-0" aria-hidden />
            Esperando la ubicación del repartidor…
          </p>
        ) : stale ? (
          <p className="flex items-start gap-2 rounded-lg bg-warning px-3 py-2 text-warning-foreground" data-testid="rider-stale">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            La ubicación no se actualiza {formatAgo(now - position.seenAt)}: puede que {riderName ?? "el repartidor"} no tenga señal. Tu
            pedido sigue en camino.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground" data-testid="rider-updated">
            <span className="size-2 rounded-full bg-success" aria-hidden />
            {now > 0 ? `Actualizado ${formatAgo(now - position.seenAt)}` : "Ubicación en vivo"}
          </p>
        )}
      </div>
    </section>
  );
}
