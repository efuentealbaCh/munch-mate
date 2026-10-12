"use client";

import { useEffect } from "react";

/**
 * Sets `data-hydrated` on `<html>` once React has hydrated the root, so browser tests can wait for an
 * interactive page instead of typing into server HTML (`waitForHydration` in `e2e/helpers.ts`). Set in an
 * effect, so the server HTML and the first client render match. Renders nothing.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return null;
}
