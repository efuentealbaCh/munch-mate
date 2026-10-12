"use client";

import type { MapConfig } from "@app/types";
import { useEffect, useState } from "react";
import { mapsApi } from "@/lib/endpoints";

/**
 * - loading: asking the api (render the page as without a map meanwhile, or a placeholder).
 * - ready: `config.available` says whether there is a map.
 * Any failure counts as "no map": maps are an extra, never a reason to block ordering or tracking.
 */
export type MapConfigState = { status: "loading"; config: null } | { status: "ready"; config: MapConfig | null };

/** One request per page load, shared by every component (a successful answer is kept; failures retry next mount). */
let cached: MapConfig | null = null;
let pending: Promise<MapConfig> | null = null;

function loadMapConfig(): Promise<MapConfig> {
  if (cached) return Promise.resolve(cached);
  pending ??= mapsApi.config().then(
    (config) => {
      cached = config;
      pending = null;
      return config;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

/**
 * The base map configuration (`GET /api/public/map-config`), cached for the page's lifetime.
 * @returns `available` = true only when the map can be drawn; `config` is null on failure.
 */
export function useMapConfig(): MapConfigState & { available: boolean } {
  const [state, setState] = useState<MapConfigState>(() =>
    cached ? { status: "ready", config: cached } : { status: "loading", config: null },
  );

  useEffect(() => {
    if (state.status === "ready") return;
    let current = true;
    loadMapConfig().then(
      (config) => current && setState({ status: "ready", config }),
      // No map rather than an error: every screen has a list fallback.
      () => current && setState({ status: "ready", config: null }),
    );
    return () => {
      current = false;
    };
  }, [state.status]);

  return { ...state, available: state.status === "ready" && state.config?.available === true } as MapConfigState & {
    available: boolean;
  };
}
