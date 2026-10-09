import type { OrderStatus } from "@app/types";
import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "./cart";
import {
  DEVICE_PUSH_KEY,
  devicePushActive,
  FOLLOWED_ORDERS_MAX,
  followOffer,
  isFollowingOrder,
  isIos,
  loadDevicePush,
  loadFollowedOrders,
  type PushEnvironment,
  pushAvailability,
  rememberFollowedOrder,
  sameKey,
  saveDevicePush,
  toSubscriptionInput,
  urlBase64ToUint8Array,
} from "./push";

function memoryStorage(fail = false): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const guard = () => {
    if (fail) throw new Error("storage disabled");
  };
  return {
    data,
    getItem: (key) => (guard(), data.get(key) ?? null),
    setItem: (key, value) => (guard(), void data.set(key, value)),
    removeItem: (key) => (guard(), void data.delete(key)),
  };
}

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url without padding", () => {
    // "-_8" is base64url for bytes FB FF (base64 "+/8=").
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([0xfb, 0xff]);
    expect([...urlBase64ToUint8Array("AQID")]).toEqual([1, 2, 3]);
  });

  it("accepts padded input and surrounding spaces", () => {
    expect([...urlBase64ToUint8Array(" AQI= ")]).toEqual([1, 2]);
  });

  it("gives the 65 bytes of a VAPID public key (uncompressed P-256 point, starts with 0x04)", () => {
    const key = `BA${"A".repeat(85)}`; // 87 base64url chars = 65 bytes
    const bytes = urlBase64ToUint8Array(key);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(0x04);
  });

  it("rejects text that is not base64url", () => {
    expect(() => urlBase64ToUint8Array("not a key!")).toThrow();
  });
});

describe("sameKey", () => {
  it("compares the subscription's key with the server's", () => {
    const key = new Uint8Array([4, 1, 2]);
    expect(sameKey(new Uint8Array([4, 1, 2]).buffer, key)).toBe(true);
    expect(sameKey(new Uint8Array([4, 1, 3]).buffer, key)).toBe(false);
    expect(sameKey(new Uint8Array([4, 1]).buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });
});

describe("toSubscriptionInput", () => {
  it("keeps endpoint and keys", () => {
    expect(toSubscriptionInput({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "p", auth: "a", extra: "z" } })).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/x",
      keys: { p256dh: "p", auth: "a" },
    });
  });

  it("rejects incomplete subscriptions", () => {
    expect(toSubscriptionInput({ endpoint: "https://x", keys: { p256dh: "p" } })).toBeNull();
    expect(toSubscriptionInput({ endpoint: null, keys: { p256dh: "p", auth: "a" } })).toBeNull();
    expect(toSubscriptionInput({})).toBeNull();
  });
});

describe("pushAvailability", () => {
  const capable: PushEnvironment = {
    userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130",
    maxTouchPoints: 5,
    standalone: false,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
  };
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1";

  it("is ready on a capable browser", () => {
    expect(pushAvailability(capable)).toBe("ready");
  });

  it("is unsupported without service workers or PushManager", () => {
    expect(pushAvailability({ ...capable, hasPushManager: false })).toBe("unsupported");
    expect(pushAvailability({ ...capable, hasServiceWorker: false })).toBe("unsupported");
    expect(pushAvailability({ ...capable, hasNotification: false })).toBe("unsupported");
  });

  it("asks iPhone users to install first (Safari hides PushManager until then)", () => {
    expect(pushAvailability({ ...capable, userAgent: iphone, hasPushManager: false })).toBe("ios-install");
    expect(pushAvailability({ ...capable, userAgent: iphone, standalone: true })).toBe("ready");
  });

  it("detects iPadOS, which reports itself as a Mac with touch", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15";
    expect(isIos({ userAgent: mac, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: mac, maxTouchPoints: 0 })).toBe(false);
  });
});

describe("followOffer", () => {
  const offer = (channel: "dine_in" | "pickup" | "delivery", status: OrderStatus) => followOffer({ channel, status });

  it("pickup: until the order is ready (that is what gets notified)", () => {
    for (const status of ["pending", "accepted", "preparing"] as const) {
      expect(offer("pickup", status)?.label).toBe("Avísame cuando esté listo");
    }
    for (const status of ["ready", "picked_up", "rejected", "cancelled"] as const) expect(offer("pickup", status)).toBeNull();
  });

  it("delivery: until it leaves with the rider", () => {
    for (const status of ["pending", "accepted", "preparing", "ready"] as const) {
      expect(offer("delivery", status)?.label).toBe("Avísame cuando salga");
    }
    for (const status of ["out_for_delivery", "delivered", "cancelled"] as const) expect(offer("delivery", status)).toBeNull();
  });

  it("never for dine-in (the food comes to the table)", () => {
    expect(offer("dine_in", "pending")).toBeNull();
    expect(offer("dine_in", "preparing")).toBeNull();
  });

  it("says what was turned on", () => {
    expect(offer("pickup", "pending")?.done).toBe("Te avisaremos cuando esté listo");
  });
});

describe("followed orders on the device", () => {
  it("remembers tokens, newest first, without duplicates", () => {
    const storage = memoryStorage();
    rememberFollowedOrder(storage, "a");
    rememberFollowedOrder(storage, "b");
    rememberFollowedOrder(storage, "a");
    expect(loadFollowedOrders(storage)).toEqual(["a", "b"]);
    expect(isFollowingOrder(storage, "b")).toBe(true);
    expect(isFollowingOrder(storage, "c")).toBe(false);
  });

  it("keeps a bounded list", () => {
    const storage = memoryStorage();
    for (let i = 0; i < FOLLOWED_ORDERS_MAX + 5; i++) rememberFollowedOrder(storage, `t${i}`);
    expect(loadFollowedOrders(storage)).toHaveLength(FOLLOWED_ORDERS_MAX);
  });

  it("copes with broken or disabled storage", () => {
    const storage = memoryStorage();
    storage.data.set("mm:push-followed", "{nope");
    expect(loadFollowedOrders(storage)).toEqual([]);
    expect(() => rememberFollowedOrder(memoryStorage(true), "a")).not.toThrow();
    expect(isFollowingOrder(undefined, "a")).toBe(false);
  });
});

describe("device switch (staff, riders)", () => {
  it("stores and clears the record", () => {
    const storage = memoryStorage();
    saveDevicePush(storage, { userId: "u1", endpoint: "https://e" });
    expect(loadDevicePush(storage)).toEqual({ userId: "u1", endpoint: "https://e" });
    saveDevicePush(storage, null);
    expect(storage.data.has(DEVICE_PUSH_KEY)).toBe(false);
  });

  it("ignores malformed records", () => {
    const storage = memoryStorage();
    storage.data.set(DEVICE_PUSH_KEY, JSON.stringify({ userId: 1 }));
    expect(loadDevicePush(storage)).toBeNull();
  });

  it("is on only for the same user, the same browser subscription and a granted permission", () => {
    const record = { userId: "u1", endpoint: "https://e" };
    expect(devicePushActive(record, "u1", "https://e", "granted")).toBe(true);
    // Another account logged in on this phone.
    expect(devicePushActive(record, "u2", "https://e", "granted")).toBe(false);
    // The browser renewed its subscription (new endpoint): must be turned on again.
    expect(devicePushActive(record, "u1", "https://other", "granted")).toBe(false);
    expect(devicePushActive(record, "u1", "https://e", "denied")).toBe(false);
    expect(devicePushActive(null, "u1", "https://e", "granted")).toBe(false);
  });
});
