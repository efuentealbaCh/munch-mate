"use client";

import type { PushConfig } from "@app/types";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { localStore } from "@/lib/browser-storage";
import { pushApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import {
  currentPermission,
  devicePushActive,
  enablePush,
  existingSubscription,
  isFollowingOrder,
  loadDevicePush,
  PUSH_MESSAGES,
  type PushAvailability,
  pushAvailability,
  PushSetupError,
  readPushEnvironment,
  rememberFollowedOrder,
  saveDevicePush,
} from "@/lib/push";

// ── Server config (one request per page load, like the map config) ──────────

let cached: PushConfig | null = null;
let pending: Promise<PushConfig> | null = null;

function loadPushConfig(): Promise<PushConfig> {
  if (cached) return Promise.resolve(cached);
  pending ??= pushApi.config().then(
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
 * - hidden: still loading, push not configured on the server (publicKey null), config failed, or a browser
 *   without push. Nothing about notifications is shown.
 * - ios-install: iPhone in the browser: the button explains how to install first.
 * - ready: the button works; `permission` says whether the browser already blocked us.
 */
export type PushUiState = { kind: "hidden" } | { kind: "ios-install" } | { kind: "ready"; permission: NotificationPermission };

function usePushBase(): { state: PushUiState; publicKey: string | null; disable(): void; refreshPermission(): void } {
  const [publicKey, setPublicKey] = useState<string | null>(cached?.publicKey ?? null);
  const [availability, setAvailability] = useState<PushAvailability | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    setAvailability(pushAvailability(readPushEnvironment()));
    setPermission(currentPermission());
    let current = true;
    loadPushConfig().then(
      (config) => current && setPublicKey(config.publicKey),
      // Notifications are an extra: a failure just hides them.
      () => current && setPublicKey(null),
    );
    return () => {
      current = false;
    };
  }, []);

  const state: PushUiState =
    !publicKey || availability === null || availability === "unsupported"
      ? { kind: "hidden" }
      : availability === "ios-install"
        ? { kind: "ios-install" }
        : { kind: "ready", permission };

  return {
    state,
    publicKey,
    // The api answered PUSH_NOT_CONFIGURED (keys removed since the page loaded).
    disable: useCallback(() => {
      cached = { publicKey: null };
      setPublicKey(null);
    }, []),
    refreshPermission: useCallback(() => setPermission(currentPermission()), []),
  };
}

/** Message for a failed activation; null when the failure means "hide push" (handled by the caller). */
function failureMessage(error: unknown): string | null {
  if (error instanceof PushSetupError) return PUSH_MESSAGES[error.reason];
  if (hasCode(error, "PUSH_NOT_CONFIGURED")) return null;
  if (hasCode(error, "INVALID_PUSH_ENDPOINT")) return PUSH_MESSAGES.incompatible;
  return errorMessage(error);
}

export interface PushControl {
  state: PushUiState;
  /** On for this device / this order. */
  active: boolean;
  busy: boolean;
  /** Why it is not on (denied, iPhone, error): shown under the button. */
  message: string | null;
  /** Call straight from the click handler (the permission prompt needs the user gesture). */
  toggle(): void;
}

// ── Staff and riders: this device gets the account's notifications ──────────

/**
 * "Activar avisos en este dispositivo" (board) / "Avísame cuando me asignen un pedido" (riders). One switch
 * per device and account: the server sends new orders to board staff and assignments to riders.
 */
export function useDevicePush(userId: string): PushControl {
  const base = usePushBase();
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ready = base.state.kind === "ready";

  useEffect(() => {
    if (!ready) return;
    let current = true;
    existingSubscription().then(
      (subscription) =>
        current && setActive(devicePushActive(loadDevicePush(localStore()), userId, subscription?.endpoint ?? null, currentPermission())),
      () => current && setActive(false),
    );
    return () => {
      current = false;
    };
  }, [ready, userId]);

  function toggle() {
    if (busy) return;
    setMessage(null);
    if (base.state.kind === "ios-install") {
      setMessage(PUSH_MESSAGES.iosInstall);
      return;
    }
    if (base.state.kind !== "ready" || !base.publicKey) return;
    if (active) {
      void turnOff();
      return;
    }
    if (base.state.permission === "denied") {
      setMessage(PUSH_MESSAGES.denied);
      return;
    }
    setBusy(true);
    // Started synchronously: enablePush asks for the permission before awaiting anything.
    void enablePush(base.publicKey)
      .then(async (subscription) => {
        await pushApi.subscribeDevice(subscription);
        saveDevicePush(localStore(), { userId, endpoint: subscription.endpoint });
        setActive(true);
        toast.success("Avisos activados en este dispositivo");
      })
      .catch((error: unknown) => {
        if (hasCode(error, "PUSH_NOT_CONFIGURED")) base.disable();
        setMessage(failureMessage(error));
      })
      .finally(() => {
        base.refreshPermission();
        setBusy(false);
      });
  }

  async function turnOff() {
    const record = loadDevicePush(localStore());
    setBusy(true);
    try {
      if (record) await pushApi.unsubscribeDevice(record.endpoint);
      // The browser subscription stays: orders this browser follows ("Avísame") use it too.
      saveDevicePush(localStore(), null);
      setActive(false);
      toast.success("Avisos desactivados en este dispositivo");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return { state: base.state, active, busy, message, toggle };
}

/**
 * Before logging out: stop sending this account's notifications to this device (a shared phone must not
 * keep getting them). Best effort: never blocks the logout.
 */
export async function forgetDevicePush(userId: string): Promise<void> {
  const record = loadDevicePush(localStore());
  if (!record || record.userId !== userId) return;
  try {
    await pushApi.unsubscribeDevice(record.endpoint);
  } catch {
    // Offline or session already gone: the server drops it when the push service reports it gone.
  }
  saveDevicePush(localStore(), null);
}

// ── Customers: "Avísame" for one order ──────────────────────────────────────

/** Follows one order with this browser (guests too). `active` is remembered per order on the device. */
export function useOrderFollow(accessToken: string): PushControl & { finished: boolean } {
  const base = usePushBase();
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => setActive(isFollowingOrder(localStore(), accessToken)), [accessToken]);

  function toggle() {
    if (busy || active) return;
    setMessage(null);
    if (base.state.kind === "ios-install") {
      setMessage(PUSH_MESSAGES.iosInstall);
      return;
    }
    if (base.state.kind !== "ready" || !base.publicKey) return;
    if (base.state.permission === "denied") {
      setMessage(PUSH_MESSAGES.denied);
      return;
    }
    setBusy(true);
    void enablePush(base.publicKey)
      .then(async (subscription) => {
        await pushApi.followOrder(accessToken, subscription);
        rememberFollowedOrder(localStore(), accessToken);
        setActive(true);
      })
      .catch((error: unknown) => {
        if (hasCode(error, "PUSH_NOT_CONFIGURED")) base.disable();
        if (hasCode(error, "ORDER_FINISHED")) {
          setFinished(true);
          return;
        }
        setMessage(failureMessage(error));
      })
      .finally(() => {
        base.refreshPermission();
        setBusy(false);
      });
  }

  return { state: base.state, active, busy, message, toggle, finished };
}
