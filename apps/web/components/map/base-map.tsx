"use client";

import type { GeoPoint, MapConfig } from "@app/types";
import { roundCoord } from "@app/utils";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { MapIcon } from "lucide-react";
import {
  addProtocol,
  type GeoJSONSource,
  type LngLat,
  Map as MapLibreMap,
  type MapMouseEvent,
  NavigationControl,
  setWorkerUrl,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { absoluteMapUrl, DEFAULT_CENTER, DEFAULT_ZOOM } from "@/lib/maps";
import { cn } from "@/lib/utils";

/**
 * MapLibre base shared by every map of the app. Only imported through `components/map/index.tsx`
 * (next/dynamic, ssr: false), so MapLibre (~1 MB) loads only on the screens that draw a map.
 */

/** Brand colors for map overlays (MapLibre paints with plain colors, not CSS variables). */
export const MAP_COLORS = {
  /** --primary (orange-700). */
  brand: "#c2410c",
  /** stone-500: other zones, for reference. */
  muted: "#78716c",
  /** sky-700: the rider. */
  rider: "#0369a1",
} as const;

/** Data of a GeoJSON source (MapLibre's own type, so no @types/geojson dependency is needed). */
export type GeoJSONData = Parameters<GeoJSONSource["setData"]>[0];

/** Where `pnpm dev`/`build` copy MapLibre's worker (scripts/copy-maplibre-worker.mjs). */
const WORKER_PATH = "/maplibre/maplibre-gl-worker.mjs";

let runtimeReady = false;

/**
 * Once per page: the pmtiles:// protocol (range requests to the archive served by the api) and the worker
 * URL. MapLibre 6 locates its worker next to its own module (import.meta.url), which does not survive
 * Next's bundling, so the worker is served from /public instead.
 */
function ensureMapRuntime(): void {
  if (runtimeReady) return;
  runtimeReady = true;
  setWorkerUrl(`${window.location.origin}${WORKER_PATH}`);
  const protocol = new Protocol();
  addProtocol("pmtiles", protocol.tile);
}

/** Protomaps basemap, light theme, labels in Spanish, everything same-origin. */
export function baseMapStyle(config: MapConfig, origin: string): StyleSpecification {
  return {
    version: 8,
    glyphs: absoluteMapUrl(config.glyphsUrl, origin),
    sprite: absoluteMapUrl(config.spriteUrl, origin),
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${absoluteMapUrl(config.tilesUrl, origin)}`,
        attribution: config.attribution,
      },
    },
    // Same style spec, typed by @protomaps/basemaps' own copy of it.
    layers: layers("protomaps", namedFlavor("light"), { lang: "es" }) as StyleSpecification["layers"],
  };
}

/** Spanish texts of MapLibre's controls. */
const LOCALE: Record<string, string> = {
  "Map.Title": "Mapa",
  "Marker.Title": "Marcador",
  "NavigationControl.ZoomIn": "Acercar",
  "NavigationControl.ZoomOut": "Alejar",
  "NavigationControl.ResetBearing": "Orientar al norte",
  "AttributionControl.ToggleAttribution": "Mostrar créditos del mapa",
  "AttributionControl.MapFeedback": "Corregir el mapa",
  "CooperativeGesturesHandler.WindowsHelpText": "Usa Ctrl + rueda para acercar o alejar el mapa",
  "CooperativeGesturesHandler.MacHelpText": "Usa ⌘ + rueda para acercar o alejar el mapa",
  "CooperativeGesturesHandler.MobileHelpText": "Usa dos dedos para mover el mapa",
};

export interface BaseMapOptions {
  config: MapConfig;
  /** Initial center (later changes are ignored: the caller moves the camera). Santiago by default. */
  center?: GeoPoint | null;
  zoom?: number;
  /**
   * Two fingers to pan on phones, Ctrl + wheel to zoom on desktop. For maps inside scrolling pages (the
   * checkout), so a swipe still scrolls the page.
   */
  cooperative?: boolean;
}

export interface BaseMap {
  containerRef: RefObject<HTMLDivElement | null>;
  /** The map once its style loaded (add sources and layers then); null before and after unmount. */
  map: MapLibreMap | null;
  /** WebGL unavailable or the map data could not be loaded. */
  failed: boolean;
}

/** Creates the map in `containerRef` and removes it on unmount. */
export function useBaseMap({ config, center, zoom = DEFAULT_ZOOM, cooperative = false }: BaseMapOptions): BaseMap {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);
  // Only the first values matter (see BaseMapOptions.center).
  const initial = useRef({ center: center ?? DEFAULT_CENTER, zoom, cooperative });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let instance: MapLibreMap;
    try {
      ensureMapRuntime();
      const { center: start, zoom: startZoom, cooperative: coop } = initial.current;
      instance = new MapLibreMap({
        container,
        style: baseMapStyle(config, window.location.origin),
        center: [start.lng, start.lat],
        zoom: startZoom,
        attributionControl: { compact: false },
        cooperativeGestures: coop,
        // Street maps: no rotation or tilt, they only confuse on a phone.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        locale: LOCALE,
      });
    } catch {
      // No WebGL (old phone, disabled GPU): the pages work without the map.
      setFailed(true);
      return;
    }
    instance.touchZoomRotate.disableRotation();
    instance.keyboard.disableRotation();
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    let loaded = false;
    instance.on("load", () => {
      loaded = true;
      setFailed(false);
      setMap(instance);
    });
    // Before "load" an error means the style or the archive could not be read; later ones are single tiles.
    instance.on("error", () => {
      if (!loaded) setFailed(true);
    });
    return () => {
      setMap(null);
      instance.remove();
    };
  }, [config]);

  return { containerRef, map, failed };
}

/** A point from a map event, rounded like the api stores it. */
export function eventPoint(lngLat: LngLat): GeoPoint {
  return { lat: roundCoord(lngLat.lat), lng: roundCoord(lngLat.lng) };
}

/** Whether a map click started on a marker (MapLibre reports those as map clicks too). */
export function clickedMarker(event: MapMouseEvent): boolean {
  const target = event.originalEvent.target;
  return target instanceof Element && target.closest(".maplibregl-marker") !== null;
}

/** The map's box: a labelled region, with a fallback message when the map cannot be shown. */
export function MapFrame({
  map,
  label,
  className,
  children,
}: {
  map: BaseMap;
  label: string;
  className?: string;
  /** Overlays (buttons) drawn over the map. */
  children?: ReactNode;
}) {
  return (
    <div role="region" aria-label={label} className={cn("relative h-full w-full overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10", className)}>
      <div ref={map.containerRef} className="absolute inset-0" />
      {map.failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted p-4 text-center text-sm text-muted-foreground" role="status">
          <MapIcon className="size-6" aria-hidden />
          No pudimos cargar el mapa. Puedes seguir sin él.
        </div>
      ) : null}
      {children}
    </div>
  );
}
