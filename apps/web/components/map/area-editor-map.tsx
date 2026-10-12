"use client";

import type { GeoArea, GeoPoint, MapConfig } from "@app/types";
import { type GeoJSONSource, Marker } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { boundsOf } from "@/lib/maps";
import { clickedMarker, eventPoint, type GeoJSONData, MAP_COLORS, MapFrame, useBaseMap } from "./base-map";

export interface AreaEditorMapProps {
  config: MapConfig;
  center?: GeoPoint | null;
  /** Vertices being edited, in order (open ring). */
  points: GeoArea;
  /** Other zones, drawn in gray for reference. */
  others: readonly { name: string; area: GeoArea }[];
  selected: number | null;
  onAdd(point: GeoPoint): void;
  onMove(index: number, point: GeoPoint): void;
  onSelect(index: number | null): void;
  label: string;
}

const EDIT_SOURCE = "area-editor-shape";
const OTHERS_SOURCE = "area-editor-others";

const ring = (area: GeoArea) => [...area, area[0]!].map((p) => [p.lng, p.lat]);

/** The shape being drawn: a polygon from 3 vertices, a line with 2. */
function shapeData(points: GeoArea): GeoJSONData {
  const features =
    points.length >= 3
      ? [{ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring(points)] } }]
      : points.length === 2
        ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: points.map((p) => [p.lng, p.lat]) } }]
        : [];
  return { type: "FeatureCollection", features };
}

function othersData(others: AreaEditorMapProps["others"]): GeoJSONData {
  return {
    type: "FeatureCollection",
    features: others
      .filter((zone) => zone.area.length >= 3)
      .map((zone) => ({
        type: "Feature" as const,
        properties: { name: zone.name },
        geometry: { type: "Polygon" as const, coordinates: [ring(zone.area)] },
      })),
  };
}

/** Vertex handle: a round, finger-sized target. */
function vertexElement(): HTMLDivElement {
  const element = document.createElement("div");
  element.className =
    "size-6 cursor-grab rounded-full border-[3px] border-white shadow-md outline-none bg-white ring-2 ring-primary data-[selected=true]:size-7 data-[selected=true]:bg-primary focus-visible:ring-4";
  return element;
}

/**
 * Polygon editor: tap the map to add a vertex (on the nearest side once there is a shape), drag vertices
 * to move them, tap a vertex to select it (the toolbar can then remove it). The other zones show in gray.
 * Changes go through the callbacks; the drawn shape follows the drag live without re-rendering React.
 */
export function AreaEditorMap({ config, center, points, others, selected, onAdd, onMove, onSelect, label }: AreaEditorMapProps) {
  const base = useBaseMap({ config, center });
  const { map } = base;
  const markers = useRef<Marker[]>([]);
  const pointsRef = useRef(points);
  const callbacks = useRef({ onAdd, onMove, onSelect });
  useEffect(() => {
    pointsRef.current = points;
    callbacks.current = { onAdd, onMove, onSelect };
  });

  // First frame: the area, else the other zones, else the restaurant.
  const framed = useRef(false);
  useEffect(() => {
    if (!map || framed.current) return;
    framed.current = true;
    const box = boundsOf(points.length > 0 ? points : others.flatMap((zone) => zone.area));
    if (box) map.fitBounds(box, { padding: 48, maxZoom: 15, duration: 0 });
  }, [map, points, others]);

  // Layers: other zones (gray) under the edited shape (brand color).
  useEffect(() => {
    if (!map) return;
    const source = map.getSource<GeoJSONSource>(OTHERS_SOURCE);
    if (source) {
      source.setData(othersData(others));
      return;
    }
    map.addSource(OTHERS_SOURCE, { type: "geojson", data: othersData(others) });
    map.addLayer({ id: `${OTHERS_SOURCE}-fill`, type: "fill", source: OTHERS_SOURCE, paint: { "fill-color": MAP_COLORS.muted, "fill-opacity": 0.12 } });
    map.addLayer({
      id: `${OTHERS_SOURCE}-line`,
      type: "line",
      source: OTHERS_SOURCE,
      paint: { "line-color": MAP_COLORS.muted, "line-width": 1.5, "line-dasharray": [2, 2] },
    });
    map.addLayer({
      id: `${OTHERS_SOURCE}-label`,
      type: "symbol",
      source: OTHERS_SOURCE,
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Medium"], "text-size": 12 },
      paint: { "text-color": "#57534e", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
    });
  }, [map, others]);

  useEffect(() => {
    if (!map) return;
    const source = map.getSource<GeoJSONSource>(EDIT_SOURCE);
    if (source) {
      source.setData(shapeData(points));
      return;
    }
    map.addSource(EDIT_SOURCE, { type: "geojson", data: shapeData(points) });
    map.addLayer({
      id: `${EDIT_SOURCE}-fill`,
      type: "fill",
      source: EDIT_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": MAP_COLORS.brand, "fill-opacity": 0.2 },
    });
    map.addLayer({ id: `${EDIT_SOURCE}-line`, type: "line", source: EDIT_SOURCE, paint: { "line-color": MAP_COLORS.brand, "line-width": 2.5 } });
  }, [map, points]);

  // Tap the map: new vertex.
  useEffect(() => {
    if (!map) return;
    const onClick = (event: Parameters<typeof clickedMarker>[0]) => {
      if (clickedMarker(event)) return;
      callbacks.current.onAdd(eventPoint(event.lngLat));
    };
    map.on("click", onClick);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  // Vertex handles, kept in sync with the points (created/removed as the count changes).
  useEffect(() => {
    if (!map) return;
    const list = markers.current;
    while (list.length > points.length) list.pop()!.remove();
    while (list.length < points.length) {
      const index = list.length;
      const element = vertexElement();
      element.tabIndex = 0;
      const marker = new Marker({ element, draggable: true }).setLngLat([points[index]!.lng, points[index]!.lat]).addTo(map);
      let dragged = false;
      marker.on("dragstart", () => {
        dragged = true;
      });
      // Live preview while dragging; the state changes once, on release.
      marker.on("drag", () => {
        const preview = pointsRef.current.map((p, i) => (i === index ? eventPoint(marker.getLngLat()) : p));
        map.getSource<GeoJSONSource>(EDIT_SOURCE)?.setData(shapeData(preview));
      });
      marker.on("dragend", () => callbacks.current.onMove(index, eventPoint(marker.getLngLat())));
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        // A drag ends with a click on the handle: that is not a selection.
        if (dragged) {
          dragged = false;
          return;
        }
        callbacks.current.onSelect(index);
      });
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          callbacks.current.onSelect(index);
        }
      });
      list.push(marker);
    }
    list.forEach((marker, index) => {
      marker.setLngLat([points[index]!.lng, points[index]!.lat]);
      const element = marker.getElement();
      element.dataset.selected = String(index === selected);
      element.setAttribute("aria-label", `Punto ${index + 1} de ${points.length}${index === selected ? " (seleccionado)" : ""}`);
      element.setAttribute("role", "button");
    });
  }, [map, points, selected]);

  useEffect(
    () => () => {
      for (const marker of markers.current) marker.remove();
      markers.current = [];
    },
    [map],
  );

  return <MapFrame map={base} label={label} />;
}
