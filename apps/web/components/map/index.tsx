"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Entry point of the maps: client-only (MapLibre needs the DOM and WebGL) and split out of the page bundle,
 * so screens without a map never download it. Give the parent a height; the map fills it.
 */

function MapLoading() {
  return <Skeleton className="h-full w-full rounded-lg" aria-busy="true" aria-label="Cargando mapa" />;
}

export const PinMap = dynamic(() => import("./pin-map").then((m) => m.PinMap), { ssr: false, loading: MapLoading });
export const AreaEditorMap = dynamic(() => import("./area-editor-map").then((m) => m.AreaEditorMap), {
  ssr: false,
  loading: MapLoading,
});
export const TrackingMap = dynamic(() => import("./tracking-map").then((m) => m.TrackingMap), { ssr: false, loading: MapLoading });

export type { PinMapZone } from "./pin-map";
