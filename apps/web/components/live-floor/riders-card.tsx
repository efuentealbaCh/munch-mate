"use client";

import type { GeoArea, GeoPoint, MapConfig, OrderView } from "@app/types";
import { Maximize2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { RidersMap, type RidersMapRider } from "@/components/map";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
 * available; otherwise, or while it loads, the list of deliveries on their way. With `expandable` (desktop, where
 * the card is a small corner of the scene) «Ampliar» opens the same map large in a dialog, next to the list.
 */
export function RidersCard({
  model,
  now,
  positions,
  map,
  zones,
  center,
  onSelect,
  expandable = false,
  className,
}: {
  model: LiveModel;
  now: number;
  positions: ReadonlyMap<string, TrackedPosition>;
  map: { status: "loading" | "ready"; available: boolean; config: MapConfig | null };
  zones: readonly { id: string; area: GeoArea }[];
  center: GeoPoint | null;
  onSelect(target: LiveTarget): void;
  expandable?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
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
  const summary = model.onTheWay.length === 0 ? "Ninguno en ruta" : `${model.onTheWay.length} en ruta${zone ? ` · ${zone}` : ""}`;
  const canExpand = expandable && map.status === "ready" && map.available && map.config !== null;
  return (
    <section className={cn(GLASS, "flex min-w-0 flex-col gap-2 p-3", className)} aria-label="Repartos en curso" data-testid="live-riders">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[13px] font-bold">Repartos en curso</h2>
          <span className="text-xs text-muted-foreground">{summary}</span>
        </div>
        {canExpand ? (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setExpanded(true)}
            aria-label="Ampliar el mapa de repartos"
            title="Ampliar mapa"
            data-testid="live-riders-expand"
          >
            <Maximize2Icon aria-hidden />
          </Button>
        ) : null}
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
      {canExpand && map.config ? (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="flex h-[min(82vh,860px)] flex-col sm:max-w-[min(1240px,calc(100%-4rem))]" data-testid="live-riders-dialog">
            <DialogHeader>
              <DialogTitle>Repartos en curso</DialogTitle>
              <DialogDescription>
                {model.onTheWay.length === 0 ? `${summary}.` : `${summary}. Toca un repartidor para ver su pedido.`}
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 gap-4">
              {/* Mounted only while open: a second MapLibre instance, sized by this box (fixed height above). */}
              <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl">
                <RidersMap
                  config={map.config}
                  center={center}
                  zones={zones}
                  riders={riders}
                  onSelect={(id) => {
                    setExpanded(false);
                    onSelect({ kind: "order", id });
                  }}
                  label="Mapa ampliado de los repartos en curso"
                />
              </div>
              <div className="flex w-72 shrink-0 flex-col overflow-y-auto">
                <QueueList
                  rows={rows}
                  tab="delivery"
                  onSelect={(target) => {
                    setExpanded(false);
                    onSelect(target);
                  }}
                  label="Repartos en ruta"
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
