"use client";

import type { MapConfig, OrderView } from "@app/types";
import { useCallback, useEffect, useState } from "react";
import { TrackingMap } from "@/components/map";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNow } from "@/hooks/use-now";
import { useSocketEvent } from "@/hooks/use-realtime";
import { ordersApi } from "@/lib/endpoints";
import { formatAgo, isStalePosition, type TrackedPosition, trackPosition } from "@/lib/maps";
import { useRestaurantRealtime } from "../restaurant-realtime";

/** "Seguir al repartidor" on the board: the rider of a delivery on its way, live, with the destination. */
export function RiderMapDialog({
  restaurantId,
  order,
  config,
  onOpenChange,
}: {
  restaurantId: string;
  /** null = closed. */
  order: OrderView | null;
  config: MapConfig;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={order !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-2xl">
        {order ? <RiderMap key={order.id} restaurantId={restaurantId} order={order} config={config} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RiderMap({ restaurantId, order, config }: { restaurantId: string; order: OrderView; config: MapConfig }) {
  const { socket, syncCount } = useRestaurantRealtime();
  const now = useNow(5_000);
  const [position, setPosition] = useState<TrackedPosition | null>(null);
  const [loading, setLoading] = useState(true);

  const keepNewest = useCallback(
    (incoming: TrackedPosition) => setPosition((current) => (current && current.at > incoming.at ? current : incoming)),
    [],
  );

  // On open and after every reconnect (events missed while offline are not replayed).
  useEffect(() => {
    const controller = new AbortController();
    ordersApi.riderLocation(restaurantId, order.id, controller.signal).then(
      ({ position: last }) => {
        if (last) keepNewest(trackPosition(last, Date.now(), false));
        setLoading(false);
      },
      () => {
        if (!controller.signal.aborted) setLoading(false);
      },
    );
    return () => controller.abort();
  }, [restaurantId, order.id, syncCount, keepNewest]);

  useSocketEvent(socket, "order.rider-location", (payload) => {
    if (payload.orderId === order.id) keepNewest(trackPosition(payload, Date.now(), true));
  });

  const point = position ? { lat: position.lat, lng: position.lng } : null;
  const destination = order.delivery?.location ?? null;
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          Pedido #{order.ticketNumber} · {order.rider?.name ?? "Repartidor"}
        </DialogTitle>
        <DialogDescription>
          {order.delivery ? `${order.delivery.address} · ${order.delivery.zoneName}` : "Delivery en reparto"}
          {destination ? "" : " (el cliente no marcó su ubicación en el mapa)"}
        </DialogDescription>
      </DialogHeader>
      {point || destination ? (
        <div className="h-[50dvh] min-h-64 w-full">
          <TrackingMap
            config={config}
            destination={destination}
            rider={point}
            riderLabel={order.rider?.name ?? "Repartidor"}
            label={`Mapa del reparto #${order.ticketNumber}`}
          />
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite" data-testid="rider-map-status">
        {loading && !position
          ? "Buscando la ubicación del repartidor…"
          : !position
            ? "Todavía no llega la ubicación del repartidor (su teléfono debe tener abierta la pantalla Repartos)."
            : now > 0 && isStalePosition(position, now)
              ? `La ubicación no se actualiza ${formatAgo(now - position.seenAt)}: puede no tener señal.`
              : now > 0
                ? `Actualizado ${formatAgo(now - position.seenAt)}`
                : "Ubicación en vivo"}
      </p>
    </div>
  );
}
