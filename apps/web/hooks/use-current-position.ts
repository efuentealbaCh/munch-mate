"use client";

import type { GeoPoint } from "@app/types";
import { roundCoord } from "@app/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { type GeolocationFailure, geolocationFailure } from "@/lib/maps";

export interface CurrentPosition {
  point: GeoPoint;
  /** Meters (phones: a few; desktops on Wi-Fi: hundreds). */
  accuracy: number;
}

/** Why the browser cannot even be asked (no API, or not https). */
export function geolocationUnavailable(): GeolocationFailure | null {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return "unsupported";
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  return null;
}

/**
 * "Usar mi ubicación": one high-accuracy reading on demand.
 * @returns `locate()` resolves with the position, or null after setting `error`.
 */
export function useCurrentPosition(): {
  locate(): Promise<CurrentPosition | null>;
  locating: boolean;
  error: GeolocationFailure | null;
  clearError(): void;
} {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<GeolocationFailure | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const locate = useCallback(async (): Promise<CurrentPosition | null> => {
    const unavailable = geolocationUnavailable();
    if (unavailable) {
      setError(unavailable);
      return null;
    }
    setLocating(true);
    setError(null);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 }),
      );
      return {
        point: { lat: roundCoord(position.coords.latitude), lng: roundCoord(position.coords.longitude) },
        accuracy: Math.round(position.coords.accuracy),
      };
    } catch (failure) {
      if (mounted.current) setError(geolocationFailure(failure as GeolocationPositionError));
      return null;
    } finally {
      if (mounted.current) setLocating(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { locate, locating, error, clearError };
}
