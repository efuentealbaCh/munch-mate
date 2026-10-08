"use client";

import { useEffect, useRef } from "react";

/** setTimeout's maximum delay (≈ 24.8 days); longer delays would fire at once. */
const MAX_DELAY_MS = 2_147_483_647;
/** Margin after the instant, so the api (with its own clock) already agrees it has passed. */
const MARGIN_MS = 5_000;

/**
 * Calls `callback` once shortly after the instant `at` (ISO), e.g. to refresh the menu when the opening hours
 * open the restaurant. Nothing is scheduled for null or invalid dates; a new `at` replaces the previous timer.
 */
export function useRefreshAt(at: string | null, callback: () => void): void {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!at) return;
    const target = new Date(at).getTime();
    if (Number.isNaN(target)) return;
    const delay = Math.min(MAX_DELAY_MS, Math.max(0, target - Date.now()) + MARGIN_MS);
    const timer = setTimeout(() => callbackRef.current(), delay);
    return () => clearTimeout(timer);
  }, [at]);
}
