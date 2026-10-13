"use client";

import type { PrintAgentsSummary } from "@app/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { printAgentsApi } from "@/lib/endpoints";
import type { AppSocket } from "@/lib/realtime";
import { useOnVisible, useSocketEvent } from "./use-realtime";

/** The summary changes when an agent connects or drops, which emits nothing to the staff: polled. */
const SUMMARY_POLL_MS = 60_000;

/**
 * Whether the restaurant's print agents print kitchen tickets (phase 8), for the board. Loaded on mount,
 * after every (re)subscription, when a print job fails, every minute and when the tab becomes visible.
 * @param syncCount `useRestaurantRealtime().syncCount`.
 * @returns null until the first answer, and while it keeps failing: the board then prints from the browser
 *   as before the print agent existed (a failed request must not leave the kitchen without tickets).
 */
export function usePrintSummary(restaurantId: string, socket: AppSocket | null, syncCount: number) {
  const [summary, setSummary] = useState<PrintAgentsSummary | null>(null);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(() => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    printAgentsApi.summary(restaurantId, current.signal).then(
      (result) => {
        if (!current.signal.aborted) setSummary(result);
      },
      () => {
        // Keep the last known summary: a blip must not flip the board between agent and browser printing.
      },
    );
  }, [restaurantId]);

  useEffect(() => {
    reload();
    const timer = setInterval(reload, SUMMARY_POLL_MS);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, [reload, syncCount]);

  useSocketEvent(socket, "print.job-failed", () => reload());
  useOnVisible(reload);

  return { summary, reload };
}
