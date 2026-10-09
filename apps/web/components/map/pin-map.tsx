"use client";

import type { GeoArea, GeoPoint, MapConfig } from "@app/types";
import { type GeoJSONSource, Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { boundsOf, boxContains, POINT_ZOOM, samePoint } from "@/lib/maps";
import { clickedMarker, eventPoint, type GeoJSONData, MAP_COLORS, MapFrame, useBaseMap } from "./base-map";

export interface PinMapZone {
  id: string;
  name: string;
  area: GeoArea;
}

export interface PinMapProps {
  config: MapConfig;
  /** Where to start when there is no pin and nothing to frame (the restaurant). */
  center?: GeoPoint | null;
  /** Areas drawn for reference (delivery zones). */
  zones?: readonly PinMapZone[];
  /** Highlighted zone (the one the pin fell into). */
  selectedZoneId?: string | null;
  pin: GeoPoint | null;
  /** The user dragged the pin or tapped the map. */
  onPinChange(point: GeoPoint): void;
  /** Accessible name of the map region. */
  label: string;
  /** See BaseMapOptions.cooperative. */
  cooperative?: boolean;
}

const ZONES_SOURCE = "pin-map-zones";

function zonesData(zones: readonly PinMapZone[], selected: string | null | undefined): GeoJSONData {
  return {
    type: "FeatureCollection",
    features: zones.map((zone) => ({
      type: "Feature" as const,
      properties: { name: zone.name, selected: zone.id === selected },
      geometry: { type: "Polygon" as const, coordinates: [[...zone.area, zone.area[0]!].map((p) => [p.lng, p.lat])] },
    })),
  };
}

/**
 * A map with one draggable pin: tap the map to move it there, or drag it. Optionally shows the delivery
 * zones. When the pin changes from outside (e.g. "Usar mi ubicación"), the camera follows it.
 */
export function PinMap({ config, center, zones = [], selectedZoneId, pin, onPinChange, label, cooperative }: PinMapProps) {
  const base = useBaseMap({ config, center: pin ?? center, zoom: pin ? POINT_ZOOM : undefined, cooperative });
  const { map } = base;
  const marker = useRef<Marker | null>(null);
  // The last pin this map produced itself: those do not move the camera.
  const ownPin = useRef<GeoPoint | null>(pin);
  const onChange = useRef(onPinChange);
  useEffect(() => {
    onChange.current = onPinChange;
  });

  // First frame: the pin if any, else every zone.
  const framed = useRef(false);
  useEffect(() => {
    if (!map || framed.current) return;
    framed.current = true;
    if (pin) return;
    const box = boundsOf(zones.flatMap((zone) => zone.area));
    if (box) map.fitBounds(box, { padding: 32, maxZoom: 15, duration: 0 });
  }, [map, pin, zones]);

  // Zones layer.
  useEffect(() => {
    if (!map) return;
    const data = zonesData(zones, selectedZoneId);
    const source = map.getSource<GeoJSONSource>(ZONES_SOURCE);
    if (source) {
      source.setData(data);
      return;
    }
    map.addSource(ZONES_SOURCE, { type: "geojson", data });
    map.addLayer({
      id: `${ZONES_SOURCE}-fill`,
      type: "fill",
      source: ZONES_SOURCE,
      paint: { "fill-color": MAP_COLORS.brand, "fill-opacity": ["case", ["get", "selected"], 0.22, 0.08] },
    });
    map.addLayer({
      id: `${ZONES_SOURCE}-line`,
      type: "line",
      source: ZONES_SOURCE,
      paint: { "line-color": MAP_COLORS.brand, "line-width": ["case", ["get", "selected"], 3, 1.5], "line-opacity": 0.8 },
    });
  }, [map, zones, selectedZoneId]);

  // Tapping the map moves the pin.
  useEffect(() => {
    if (!map) return;
    const onClick = (event: Parameters<typeof clickedMarker>[0]) => {
      if (clickedMarker(event)) return;
      const point = eventPoint(event.lngLat);
      ownPin.current = point;
      onChange.current(point);
    };
    map.on("click", onClick);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  // The pin itself.
  useEffect(() => {
    if (!map) return;
    if (!pin) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      const created = new Marker({ color: MAP_COLORS.brand, draggable: true }).setLngLat([pin.lng, pin.lat]).addTo(map);
      created.getElement().setAttribute("aria-label", "Punto de entrega (arrástralo para ajustarlo)");
      created.on("dragend", () => {
        const point = eventPoint(created.getLngLat());
        ownPin.current = point;
        onChange.current(point);
      });
      marker.current = created;
    } else {
      marker.current.setLngLat([pin.lng, pin.lat]);
    }
    // Moved from outside (geolocation, a remembered pin): bring it into view.
    if (!samePoint(pin, ownPin.current)) {
      ownPin.current = pin;
      const bounds = map.getBounds();
      const box = [
        [bounds.getWest(), bounds.getSouth()],
        [bounds.getEast(), bounds.getNorth()],
      ] as [[number, number], [number, number]];
      if (!boxContains(box, pin) || map.getZoom() < 14) map.easeTo({ center: [pin.lng, pin.lat], zoom: Math.max(map.getZoom(), POINT_ZOOM) });
    }
  }, [map, pin]);

  useEffect(
    () => () => {
      marker.current?.remove();
      marker.current = null;
    },
    [map],
  );

  return <MapFrame map={base} label={label} />;
}
