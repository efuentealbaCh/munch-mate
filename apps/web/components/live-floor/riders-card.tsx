"use client";

import type { GeoArea, GeoPoint, MapConfig, OrderView } from "@app/types";
import { useMemo } from "react";
import { RidersMap, type RidersMapRider } from "@/components/map";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClockTime } from "@/lib/format";
import type { LiveModel, LiveTarget } from "@/lib/live-floor";
import type { TrackedPosition } from "@/lib/maps";
import { cn } from "@/lib/utils";
import { GLASS, QueueList, queueRows } from "./panels";

function riderLabel(order: OrderView): string {
  const name = order.rider?.name.split(" ")[0] ?? "Reparto";
  return `#${order.ticketNumber} ${name}${order.estimatedReadyAt ? ` · ${formatClockTime(order.estimatedReadyAt)}` : ""}`;
}

/**
 * «Repartos en curso»: the riders on the real map (MapLibre, like «Seguir al repartidor») when the base map is
 * available; otherwise, or while it loads, the list of deliveries on their way.
 */
export function RidersCard({
  model,
  now,
  positions,
  map,
  zones,
  center,
  onSelect,
  className,
}: {
  model: LiveModel;
  now: number;
  positions: ReadonlyMap<string, TrackedPosition>;
  map: { status: "loading" | "ready"; available: boolean; config: MapConfig | null };
  zones: readonly { id: string; area: GeoArea }[];
  center: GeoPoint | null;
  onSelect(target: LiveTarget): void;
  className?: string;
}) {
  const riders = useMemo<RidersMapRider[]>(
    () =>
      model.onTheWay.map((order) => {
        const position = positions.get(order.id);
        return {
          id: order.id,
          label: riderLabel(order),
          point: position ? { lat: position.lat, lng: position.lng } : null,
          destination: order.delivery?.location ?? null,
        };
      }),
    [model.onTheWay, positions],
  );
  const zone = model.onTheWay[0]?.delivery?.zoneName;
  const rows = queueRows("delivery", model, now).filter((row) => model.onTheWay.some((o) => o.id === row.key));
  return (
    <section className={cn(GLASS, "flex min-w-0 flex-col gap-2 p-3", className)} aria-label="Repartos en curso" data-testid="live-riders">
      <div className="flex flex-col">
        <h2 className="text-[13px] font-bold">Repartos en curso</h2>
        <span className="text-xs text-muted-foreground">
          {model.onTheWay.length === 0 ? "Ninguno en ruta" : `${model.onTheWay.length} en ruta${zone ? ` · ${zone}` : ""}`}
        </span>
      </div>
      {map.status === "loading" ? (
        <Skeleton className="min-h-32 flex-1 rounded-xl" />
      ) : map.available && map.config ? (
        <div className="relative min-h-40 flex-1">
          <RidersMap
            config={map.config}
            center={center}
            zones={zones}
            riders={riders}
            onSelect={(id) => onSelect({ kind: "order", id })}
            label="Mapa de los repartos en curso"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <QueueList rows={rows} tab="delivery" onSelect={onSelect} label="Repartos en ruta" />
        </div>
      )}
    </section>
  );
}
