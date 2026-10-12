"use client";

import type { GeoPoint, SubscribeResult } from "@app/types";
import { roundCoord } from "@app/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { geolocationUnavailable } from "@/hooks/use-current-position";
import { type GeolocationFailure, geolocationFailure, reportDelay, RIDER_REPORT_FINAL_CODES } from "@/lib/maps";
import { type AppSocket, SUBSCRIBE_TIMEOUT_MS } from "@/lib/realtime";

/**
 * - active: the screen wake lock is held.
 * - unsupported: the browser has no Wake Lock API (older iPhones).
 * - denied: the browser refused it (battery saver, not visible).
 */
export type WakeLockStatus = "idle" | "active" | "unsupported" | "denied";

export interface RiderSharing {
  /** There is at least one delivery on its way: the GPS is on. */
  active: boolean;
  /** The rider's own position (for their map), rounded. */
  position: GeoPoint | null;
  geolocationError: GeolocationFailure | null;
  wakeLock: WakeLockStatus;
  /** Local time of the last report sent (ms). */
  lastSentAt: number | null;
  /** Last refusal per order (ack code, or "TIMEOUT"); cleared by the next accepted report. */
  errors: Record<string, string>;
}

/** Without a new fix, the last one is re-sent this often (keeps "Actualizado hace…" honest while stopped). */
const HEARTBEAT_MS = 20_000;
/** A fix older than this is not re-sent by the heartbeat (the GPS stopped answering). */
const FIX_MAX_AGE_MS = 60_000;

/**
 * Shares the rider's position while deliveries are on their way: watches the GPS (high accuracy), emits
 * `rider.location` for each of those orders at most every RIDER_REPORT_INTERVAL_MS (the newest fix wins),
 * keeps the screen on with the Wake Lock API (re-requested when the tab comes back: browsers drop it when
 * hidden) and stops everything when no delivery is on its way or the page closes.
 * @param onFinal Called when the api says an order cannot be tracked anymore (delivered, reassigned).
 */
export function useRiderLocationSharing({
  socket,
  orderIds,
  onFinal,
}: {
  socket: AppSocket | null;
  orderIds: readonly string[];
  onFinal?(orderId: string): void;
}): RiderSharing {
  const active = orderIds.length > 0;
  const [position, setPosition] = useState<GeoPoint | null>(null);
  const [geolocationError, setGeolocationError] = useState<GeolocationFailure | null>(null);
  const [wakeLock, setWakeLock] = useState<WakeLockStatus>("idle");
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Read by the sender, which outlives renders.
  const socketRef = useRef(socket);
  const orderIdsRef = useRef(orderIds);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    socketRef.current = socket;
    orderIdsRef.current = orderIds;
    onFinalRef.current = onFinal;
  });
  // Orders the api refused for good: no more reports for them on this page.
  const stopped = useRef(new Set<string>());
  const latest = useRef<{ point: GeoPoint; accuracy: number; at: number } | null>(null);
  const lastSent = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Sends the newest fix now, or as soon as the interval allows. Only touches refs and setters: stable. */
  const schedule = useCallback(() => {
    if (timer.current) return;
    const send = () => {
      timer.current = null;
      const fix = latest.current;
      const client = socketRef.current;
      // Offline: the next fix (or the reconnect) sends a fresh one; queued old positions are useless.
      if (!fix || !client?.connected) return;
      const now = Date.now();
      lastSent.current = now;
      setLastSentAt(now);
      for (const orderId of orderIdsRef.current) {
        if (stopped.current.has(orderId)) continue;
        const report = { orderId, lat: fix.point.lat, lng: fix.point.lng, accuracy: fix.accuracy };
        client
          .timeout(SUBSCRIBE_TIMEOUT_MS)
          .emitWithAck("rider.location", report)
          .then(
            (result: SubscribeResult) => {
              setErrors((current) => {
                if (result.ok) {
                  if (!(orderId in current)) return current;
                  const next = { ...current };
                  delete next[orderId];
                  return next;
                }
                return { ...current, [orderId]: result.code };
              });
              if (!result.ok && RIDER_REPORT_FINAL_CODES.includes(result.code)) {
                stopped.current.add(orderId);
                onFinalRef.current?.(orderId);
              }
            },
            () => setErrors((current) => ({ ...current, [orderId]: "TIMEOUT" })),
          );
      }
    };
    const delay = reportDelay(lastSent.current, Date.now());
    if (delay === 0) send();
    else timer.current = setTimeout(send, delay);
  }, []);

  // GPS watch, only while there is something to report.
  useEffect(() => {
    if (!active) return;
    const unavailable = geolocationUnavailable();
    if (unavailable) {
      setGeolocationError(unavailable);
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (fix) => {
        const point = { lat: roundCoord(fix.coords.latitude), lng: roundCoord(fix.coords.longitude) };
        latest.current = { point, accuracy: Math.round(fix.coords.accuracy), at: Date.now() };
        setPosition(point);
        setGeolocationError(null);
        schedule();
      },
      // The watch keeps running after timeouts and signal loss; only a denied permission is final.
      (failure) => setGeolocationError(geolocationFailure(failure)),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
    const heartbeat = setInterval(() => {
      if (latest.current && Date.now() - latest.current.at < FIX_MAX_AGE_MS) schedule();
    }, HEARTBEAT_MS);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(heartbeat);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      latest.current = null;
      setPosition(null);
    };
  }, [active, schedule]);

  // Back online: report right away instead of waiting for the next fix.
  useEffect(() => {
    if (!socket || !active) return;
    socket.on("connect", schedule);
    return () => {
      socket.off("connect", schedule);
    };
  }, [socket, active, schedule]);

  // A new delivery on its way gets the current position at once.
  const key = [...orderIds].sort().join(",");
  useEffect(() => {
    if (key) schedule();
  }, [key, schedule]);

  // Screen wake lock: the browser pauses the GPS of a locked phone.
  useEffect(() => {
    if (!active) return;
    if (!("wakeLock" in navigator)) {
      setWakeLock("unsupported");
      return;
    }
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const request = async () => {
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (disposed) {
          void acquired.release().catch(() => undefined);
          return;
        }
        sentinel = acquired;
        setWakeLock("active");
        acquired.addEventListener("release", () => {
          if (!disposed) setWakeLock("idle");
        });
      } catch {
        // Refused (battery saver, page not visible): sharing goes on, the page asks to keep the screen on.
        if (!disposed) setWakeLock("denied");
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!sentinel || sentinel.released) void request();
      // The GPS may have been paused while hidden: report the newest fix now.
      schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
      setWakeLock("idle");
    };
  }, [active, schedule]);

  // Errors of orders no longer on their way are not relevant anymore.
  const visibleErrors = Object.fromEntries(Object.entries(errors).filter(([orderId]) => orderIds.includes(orderId)));

  return { active, position, geolocationError, wakeLock, lastSentAt, errors: visibleErrors };
}
