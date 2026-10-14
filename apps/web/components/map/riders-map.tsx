"use client";

import type { GeoArea, GeoPoint, MapConfig } from "@app/types";
import { type GeoJSONSource, Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { boundsOf, boxContains, type LngLatBox, POINT_ZOOM } from "@/lib/maps";
import { type GeoJSONData, MAP_COLORS, MapFrame, useBaseMap } from "./base-map";

export interface RidersMapRider {
  /** Order id (what a click selects). */
  id: string;
  /** "#31 Rodrigo · 20:58". */
  label: string;
  /** Last known position; null until the rider's phone reports. */
  point: GeoPoint | null;
  /** The customer's pin, if they left one. */
  destination: GeoPoint | null;
}

export interface RidersMapProps {
  config: MapConfig;
  /** The restaurant's pin (also the starting center). */
  center: GeoPoint | null;
  /** Delivery zones drawn on the map, for reference. */
  zones: readonly { id: string; area: GeoArea }[];
  riders: readonly RidersMapRider[];
  onSelect(id: string): void;
  label: string;
}

const ZONES_SOURCE = "riders-map-zones";

function zonesData(zones: RidersMapProps["zones"]): GeoJSONData {
  return {
    type: "FeatureCollection",
    features: zones.map((zone) => ({
      type: "Feature" as const,
      properties: {},
      geometry: { type: "Polygon" as const, coordinates: [[...zone.area, zone.area[0]!].map((p) => [p.lng, p.lat])] },
    })),
  };
}

/** A rider: blue dot with its name, a button that selects the delivery in the live view. */
function riderElement(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "flex items-center gap-1 rounded-full bg-white/95 py-0.5 pr-2 pl-0.5 text-[11px] font-semibold whitespace-nowrap text-blue-700 shadow-md ring-1 ring-blue-200";
  const dot = document.createElement("span");
  dot.className = "size-3 rounded-full border-2 border-white";
  dot.style.backgroundColor = MAP_COLORS.rider;
  const text = document.createElement("span");
  text.textContent = label;
  button.append(dot, text);
  button.setAttribute("aria-label", `Repartidor ${label}`);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

/**
 * Small live map of the deliveries on their way (live view): the restaurant, the zones, each rider with its
 * name and the customers' pins. Frames everything once, and again when a rider leaves the visible area.
 */
export function RidersMap({ config, center, zones, riders, onSelect, label }: RidersMapProps) {
  const base = useBaseMap({ config, center, zoom: POINT_ZOOM - 3 });
  const { map } = base;
  const markers = useRef(new Map<string, Marker>());
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  });
  const framed = useRef(false);

  // Zones.
  useEffect(() => {
    if (!map) return;
    const data = zonesData(zones);
    const source = map.getSource<GeoJSONSource>(ZONES_SOURCE);
    if (source) {
      source.setData(data);
      return;
    }
    map.addSource(ZONES_SOURCE, { type: "geojson", data });
    map.addLayer({ id: `${ZONES_SOURCE}-fill`, type: "fill", source: ZONES_SOURCE, paint: { "fill-color": MAP_COLORS.brand, "fill-opacity": 0.08 } });
    map.addLayer({
      id: `${ZONES_SOURCE}-line`,
      type: "line",
      source: ZONES_SOURCE,
      paint: { "line-color": MAP_COLORS.brand, "line-width": 1.3, "line-opacity": 0.8, "line-dasharray": [3, 2] },
    });
  }, [map, zones]);

  // Markers: restaurant, riders and destinations, keyed so they move instead of being recreated.
  useEffect(() => {
    if (!map) return;
    const wanted = new Map<string, { point: GeoPoint; make: () => Marker }>();
    if (center) {
      wanted.set("restaurant", {
        point: center,
        make: () => {
          const marker = new Marker({ color: MAP_COLORS.brand, scale: 0.7 });
          marker.getElement().setAttribute("aria-label", "El local");
          return marker;
        },
      });
    }
    for (const rider of riders) {
      if (rider.destination) {
        wanted.set(`dest:${rider.id}`, {
          point: rider.destination,
          make: () => {
            const marker = new Marker({ color: "#1c1917", scale: 0.55 });
            marker.getElement().setAttribute("aria-label", `Destino de ${rider.label}`);
            return marker;
          },
        });
      }
      if (rider.point) {
        wanted.set(`rider:${rider.id}:${rider.label}`, {
          point: rider.point,
          make: () => new Marker({ element: riderElement(rider.label, () => select.current(rider.id)), anchor: "left", offset: [-6, 0] }),
        });
      }
    }
    for (const [key, marker] of markers.current) {
      if (!wanted.has(key)) {
        marker.remove();
        markers.current.delete(key);
      }
    }
    for (const [key, { point, make }] of wanted) {
      const known = markers.current.get(key);
      // A new marker gets its position before addTo: MapLibre draws it right away and fails without one.
      if (known) known.setLngLat([point.lng, point.lat]);
      else markers.current.set(key, make().setLngLat([point.lng, point.lat]).addTo(map));
    }

    const points = [...wanted.values()].map((w) => w.point);
    const riderPoints = riders.flatMap((r) => (r.point ? [r.point] : []));
    const bounds = map.getBounds();
    const view: LngLatBox = [
      [bounds.getWest(), bounds.getSouth()],
      [bounds.getEast(), bounds.getNorth()],
    ];
    const box = boundsOf(points.length > 1 ? points : [...points, ...zones.flatMap((z) => z.area)]);
    if (box && (!framed.current || riderPoints.some((p) => !boxContains(view, p)))) {
      framed.current = true;
      map.fitBounds(box, { padding: 36, maxZoom: POINT_ZOOM - 1, duration: 0 });
    }
  }, [map, center, riders, zones]);

  useEffect(() => {
    const current = markers.current;
    return () => {
      for (const marker of current.values()) marker.remove();
      current.clear();
      framed.current = false;
    };
  }, [map]);

  return <MapFrame map={base} label={label} className="rounded-xl" />;
}
