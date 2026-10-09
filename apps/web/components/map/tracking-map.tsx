"use client";

import type { GeoPoint, MapConfig } from "@app/types";
import { ScanIcon } from "lucide-react";
import { type Map as MapLibreMap, Marker } from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { boundsOf, boxContains, type LngLatBox, POINT_ZOOM } from "@/lib/maps";
import { MAP_COLORS, MapFrame, useBaseMap } from "./base-map";

export interface TrackingMapProps {
  config: MapConfig;
  /** Where the order goes (the customer's pin); null for orders placed without one. */
  destination: GeoPoint | null;
  /** The rider (or, on the rider's own phone, themself); null until the first report. */
  rider: GeoPoint | null;
  /** Accessible name of the rider marker ("Repartidor", "Tú"). */
  riderLabel: string;
  label: string;
}

/** Round "you are here" dot for the rider, with a soft halo. */
function riderElement(): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "relative flex size-6 items-center justify-center";
  const halo = document.createElement("span");
  halo.className = "absolute inset-0 animate-ping rounded-full opacity-40 motion-reduce:animate-none";
  halo.style.backgroundColor = MAP_COLORS.rider;
  const dot = document.createElement("span");
  dot.className = "relative size-4 rounded-full border-[3px] border-white shadow-md";
  dot.style.backgroundColor = MAP_COLORS.rider;
  element.append(halo, dot);
  return element;
}

function viewBox(map: MapLibreMap): LngLatBox {
  const bounds = map.getBounds();
  return [
    [bounds.getWest(), bounds.getSouth()],
    [bounds.getEast(), bounds.getNorth()],
  ];
}

/**
 * Destination and rider on one map. Frames both the first time they are known and again whenever the rider
 * leaves the visible area; otherwise the camera stays where the user put it. "Ver ambos" re-frames.
 */
export function TrackingMap({ config, destination, rider, riderLabel, label }: TrackingMapProps) {
  const base = useBaseMap({ config, center: destination ?? rider, zoom: POINT_ZOOM - 1 });
  const { map } = base;
  const destinationMarker = useRef<Marker | null>(null);
  const riderMarker = useRef<Marker | null>(null);
  const framedBoth = useRef(false);

  const frame = useCallback(
    (animate: boolean) => {
      if (!map) return;
      const points = [destination, rider].filter((p): p is GeoPoint => p !== null);
      const box = boundsOf(points);
      if (!box) return;
      if (points.length === 1) map.easeTo({ center: [points[0]!.lng, points[0]!.lat], zoom: Math.max(map.getZoom(), POINT_ZOOM - 1), duration: animate ? 500 : 0 });
      else map.fitBounds(box, { padding: 64, maxZoom: POINT_ZOOM, duration: animate ? 500 : 0 });
    },
    [map, destination, rider],
  );

  useEffect(() => {
    if (!map) return;
    if (destination) {
      if (!destinationMarker.current) {
        destinationMarker.current = new Marker({ color: MAP_COLORS.brand }).setLngLat([destination.lng, destination.lat]).addTo(map);
        destinationMarker.current.getElement().setAttribute("aria-label", "Destino de la entrega");
      } else destinationMarker.current.setLngLat([destination.lng, destination.lat]);
    } else {
      destinationMarker.current?.remove();
      destinationMarker.current = null;
    }
  }, [map, destination]);

  useEffect(() => {
    if (!map) return;
    if (!rider) {
      riderMarker.current?.remove();
      riderMarker.current = null;
      return;
    }
    if (!riderMarker.current) {
      riderMarker.current = new Marker({ element: riderElement() }).setLngLat([rider.lng, rider.lat]).addTo(map);
    } else riderMarker.current.setLngLat([rider.lng, rider.lat]);
    riderMarker.current.getElement().setAttribute("aria-label", riderLabel);
  }, [map, rider, riderLabel]);

  // Framing: both points once; afterwards only when the rider goes off screen.
  useEffect(() => {
    if (!map) return;
    const both = destination !== null && rider !== null;
    if (both && !framedBoth.current) {
      framedBoth.current = true;
      frame(true);
      return;
    }
    if (rider && !boxContains(viewBox(map), rider)) frame(true);
  }, [map, destination, rider, frame]);

  useEffect(
    () => () => {
      destinationMarker.current?.remove();
      riderMarker.current?.remove();
      destinationMarker.current = null;
      riderMarker.current = null;
      framedBoth.current = false;
    },
    [map],
  );

  return (
    <MapFrame map={base} label={label}>
      {destination && rider && map ? (
        <Button size="sm" variant="secondary" className="absolute bottom-8 left-2 shadow-md" onClick={() => frame(true)}>
          <ScanIcon aria-hidden data-icon="inline-start" />
          Ver ambos
        </Button>
      ) : null}
    </MapFrame>
  );
}
