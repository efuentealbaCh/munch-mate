"use client";

import { useEffect, useState } from "react";

/**
 * Current time (ms), refreshed every `intervalMs`. For "hace 5 min" labels; 0 during the server render
 * and the first client render, so both match (callers treat 0 as "unknown").
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
