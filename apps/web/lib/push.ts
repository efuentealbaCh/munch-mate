import type { OrderChannel, OrderStatus, PushSubscriptionInput } from "@app/types";
import type { KeyValueStorage } from "./cart";

/**
 * Web push on the web side (phase 6): VAPID key conversion, when to offer "Avísame", what this device
 * remembers, and the thin wrappers over the browser APIs (service worker + PushManager).
 *
 * One browser has ONE push subscription per service worker: the staff device switch and the customer's
 * "Avísame" share it. Turning the staff switch off therefore only tells the api to stop (DELETE), it never
 * calls `subscription.unsubscribe()`, which would also silence the orders this browser follows.
 */

// ── VAPID key ───────────────────────────────────────────────────────────────

/**
 * Converts the server's VAPID public key (base64url, no padding) to the bytes `pushManager.subscribe` wants.
 * @throws Error when the text is not base64url.
 */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const clean = base64url.trim();
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(clean)) throw new Error("Invalid base64url key");
  const body = clean.replace(/=+$/, "");
  const raw = atob(`${body}${"=".repeat((4 - (body.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Whether an existing subscription was made with this key (after a VAPID key rotation it must be renewed). */
export function sameKey(current: ArrayBuffer | null | undefined, expected: Uint8Array): boolean {
  if (!current) return false;
  const bytes = new Uint8Array(current);
  if (bytes.length !== expected.length) return false;
  return bytes.every((byte, index) => byte === expected[index]);
}

/**
 * The api body from `subscription.toJSON()`.
 * @returns null when the browser gave an incomplete subscription (no endpoint or keys).
 */
export function toSubscriptionInput(json: { endpoint?: string | null; keys?: Record<string, string> | null }): PushSubscriptionInput | null {
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

// ── Can this browser do push? ───────────────────────────────────────────────

/**
 * - ready: push works here (the permission may still be "default" or "denied").
 * - ios-install: iPhone/iPad in the browser: push only works once added to the home screen (iOS 16.4+).
 * - unsupported: no service worker / PushManager (old browser, in-app browser, http).
 */
export type PushAvailability = "ready" | "ios-install" | "unsupported";

export interface PushEnvironment {
  userAgent: string;
  /** navigator.maxTouchPoints: iPadOS reports itself as a Mac. */
  maxTouchPoints: number;
  /** Opened from the home screen (display-mode standalone or navigator.standalone). */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

export function isIos(env: Pick<PushEnvironment, "userAgent" | "maxTouchPoints">): boolean {
  if (/iPad|iPhone|iPod/.test(env.userAgent)) return true;
  return /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
}

export function pushAvailability(env: PushEnvironment): PushAvailability {
  const capable = env.hasServiceWorker && env.hasPushManager && env.hasNotification;
  // iOS Safari only exposes PushManager to installed web apps: explain how instead of hiding the option.
  if (isIos(env) && !env.standalone) return "ios-install";
  return capable ? "ready" : "unsupported";
}

export const PUSH_MESSAGES = {
  denied: "Las notificaciones están bloqueadas. Actívalas en la configuración del navegador.",
  iosInstall: "En iPhone, primero agrega Munch Mate a tu pantalla de inicio (Compartir → Agregar a inicio) y ábrelo desde ahí.",
  dismissed: "No activaste las notificaciones. Puedes intentarlo de nuevo.",
  incompatible: "Este navegador no es compatible con los avisos. Prueba con Chrome, Safari, Edge o Firefox.",
  failed: "No pudimos activar los avisos en este dispositivo. Intenta de nuevo.",
} as const;

// ── "Avísame" on the tracking page ──────────────────────────────────────────

/** What the customer is told they will be notified about (the server pushes pickup `ready` and `out_for_delivery`). */
export interface FollowOffer {
  /** Button text. */
  label: string;
  /** Shown once it is on. */
  done: string;
}

const FOLLOW_UNTIL: Partial<Record<OrderChannel, { statuses: readonly OrderStatus[]; offer: FollowOffer }>> = {
  pickup: {
    statuses: ["pending", "accepted", "preparing"],
    offer: { label: "Avísame cuando esté listo", done: "Te avisaremos cuando esté listo" },
  },
  delivery: {
    statuses: ["pending", "accepted", "preparing", "ready"],
    offer: { label: "Avísame cuando salga", done: "Te avisaremos cuando salga a reparto" },
  },
};

/**
 * The "Avísame" offer for an order, or null when there is nothing left to notify: dine-in (the food comes to
 * the table), or the notified moment already passed (ready / on its way, finished, rejected, cancelled).
 */
export function followOffer(order: { channel: OrderChannel; status: OrderStatus }): FollowOffer | null {
  const rule = FOLLOW_UNTIL[order.channel];
  return rule && rule.statuses.includes(order.status) ? rule.offer : null;
}

// ── What this device remembers (localStorage) ───────────────────────────────

/** Orders this browser follows ("Te avisaremos"). Only a display hint: the api keeps the real subscription. */
export const FOLLOWED_ORDERS_KEY = "mm:push-followed";
export const FOLLOWED_ORDERS_MAX = 20;

export function loadFollowedOrders(storage: KeyValueStorage | undefined): string[] {
  try {
    const raw = storage?.getItem(FOLLOWED_ORDERS_KEY);
    const data = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(data) ? data.filter((t): t is string => typeof t === "string" && t.length <= 100).slice(0, FOLLOWED_ORDERS_MAX) : [];
  } catch {
    return [];
  }
}

export function isFollowingOrder(storage: KeyValueStorage | undefined, accessToken: string): boolean {
  return loadFollowedOrders(storage).includes(accessToken);
}

/** Newest first, bounded. Storage failures are ignored (the button just shows up again next visit). */
export function rememberFollowedOrder(storage: KeyValueStorage | undefined, accessToken: string): void {
  const list = [accessToken, ...loadFollowedOrders(storage).filter((t) => t !== accessToken)].slice(0, FOLLOWED_ORDERS_MAX);
  try {
    storage?.setItem(FOLLOWED_ORDERS_KEY, JSON.stringify(list));
  } catch {
    // Quota or disabled storage.
  }
}

/** The endpoint this device registered for an account (staff/rider switch). */
export const DEVICE_PUSH_KEY = "mm:push-device";

export interface DevicePushRecord {
  userId: string;
  endpoint: string;
}

export function loadDevicePush(storage: KeyValueStorage | undefined): DevicePushRecord | null {
  try {
    const raw = storage?.getItem(DEVICE_PUSH_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    return typeof data.userId === "string" && typeof data.endpoint === "string" ? { userId: data.userId, endpoint: data.endpoint } : null;
  } catch {
    return null;
  }
}

export function saveDevicePush(storage: KeyValueStorage | undefined, record: DevicePushRecord | null): void {
  try {
    if (record) storage?.setItem(DEVICE_PUSH_KEY, JSON.stringify(record));
    else storage?.removeItem(DEVICE_PUSH_KEY);
  } catch {
    // Storage disabled: the switch shows "off" next visit; turning it on again is harmless (upsert).
  }
}

/**
 * Whether the account switch is on for this user on this device: the api was told about this browser's
 * current subscription (same endpoint) for this same user, and the permission is still granted.
 */
export function devicePushActive(
  record: DevicePushRecord | null,
  userId: string,
  currentEndpoint: string | null,
  permission: NotificationPermission,
): boolean {
  return permission === "granted" && record !== null && record.userId === userId && record.endpoint === currentEndpoint;
}

// ── Browser wrappers (not unit-tested: they only call browser APIs) ─────────

/** Reads the environment; on the server everything is "unsupported". */
export function readPushEnvironment(): PushEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { userAgent: "", maxTouchPoints: 0, standalone: false, hasServiceWorker: false, hasPushManager: false, hasNotification: false };
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  let standalone = nav.standalone === true;
  try {
    standalone ||= window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    // matchMedia missing: keep navigator.standalone.
  }
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
  };
}

export function currentPermission(): NotificationPermission {
  return typeof Notification === "undefined" ? "denied" : Notification.permission;
}

/**
 * This browser's current subscription, WITHOUT registering the service worker (plain visits never install it).
 * @returns null when there is no worker or no subscription yet.
 */
export async function existingSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** Thrown by {@link enablePush}; `reason` picks the message. */
export class PushSetupError extends Error {
  constructor(readonly reason: "denied" | "dismissed" | "failed") {
    super(reason);
    this.name = "PushSetupError";
  }
}

/**
 * Asks for permission, registers the service worker and returns a subscription for `publicKey` (reusing the
 * current one when it was made with the same key). MUST start inside a click handler: Safari only shows the
 * permission prompt when it is the first thing the gesture does, so nothing is awaited before it.
 * @throws PushSetupError
 */
export async function enablePush(publicKey: string): Promise<PushSubscriptionInput> {
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission === "denied") throw new PushSetupError("denied");
  if (permission !== "granted") throw new PushSetupError("dismissed");
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    const registration = await navigator.serviceWorker.ready;
    const key = urlBase64ToUint8Array(publicKey);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
      // The server rotated its VAPID keys: the old subscription can no longer be used.
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const input = toSubscriptionInput(subscription.toJSON());
    if (!input) throw new Error("Incomplete push subscription");
    return input;
  } catch (error) {
    if (error instanceof PushSetupError) throw error;
    throw new PushSetupError("failed");
  }
}
