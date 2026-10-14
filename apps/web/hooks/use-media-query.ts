"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept in sync with resizes. False during the server render and the
 * hydration pass (the server cannot know the screen), then the real value.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
