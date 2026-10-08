import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "./cart";
import {
  customerStatusHint,
  customerSteps,
  estimateLabel,
  findMyOrder,
  loadMyOrders,
  MY_ORDERS_KEY,
  type MyOrder,
  parseTrackingHash,
  rememberOrder,
  showsReadyEstimate,
  stepIndex,
  trackingHref,
} from "./order-tracking";

const TOKEN = "Qk3x9d_-aB7cD8eF9gH0iJ1kL2mN3oP4qR5sT6uV7wX";

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

const order = (n: number): MyOrder => ({
  accessToken: `${TOKEN.slice(0, 40)}${String(n).padStart(3, "0")}`,
  ticketNumber: n,
  restaurantName: "Sanguchería",
  createdAt: `2026-10-07T12:${String(n % 60).padStart(2, "0")}:00.000Z`,
  tableToken: "abcd234567",
});

describe("tracking URL", () => {
  it("puts the token in the fragment and reads it back", () => {
    const href = trackingHref(TOKEN);
    expect(href).toBe(`/pedido#t=${TOKEN}`);
    expect(parseTrackingHash(new URL(href, "https://x.cl").hash)).toBe(TOKEN);
  });

  it("rejects missing, short or malformed tokens", () => {
    expect(parseTrackingHash("")).toBeNull();
    expect(parseTrackingHash("#")).toBeNull();
    expect(parseTrackingHash("#t=")).toBeNull();
    expect(parseTrackingHash("#t=corto")).toBeNull();
    expect(parseTrackingHash(`#t=${TOKEN}<script>`)).toBeNull();
    expect(parseTrackingHash(`#x=${TOKEN}`)).toBeNull();
  });

  it("accepts the token among other fragment params", () => {
    expect(parseTrackingHash(`#a=1&t=${TOKEN}`)).toBe(TOKEN);
  });
});

describe("mis pedidos", () => {
  it("keeps the newest 10, newest first, without duplicates", () => {
    const storage = memoryStorage();
    for (let n = 1; n <= 12; n++) rememberOrder(storage, order(n));
    rememberOrder(storage, order(5));
    const list = loadMyOrders(storage);
    expect(list).toHaveLength(10);
    expect(list.map((o) => o.ticketNumber)).toEqual([5, 12, 11, 10, 9, 8, 7, 6, 4, 3]);
    expect(findMyOrder(storage, order(7).accessToken)?.tableToken).toBe("abcd234567");
  });

  it("ignores malformed entries and never throws", () => {
    const storage = memoryStorage();
    storage.setItem(MY_ORDERS_KEY, JSON.stringify([order(1), { accessToken: "x" }, null, "nope"]));
    expect(loadMyOrders(storage)).toEqual([order(1)]);
    storage.setItem(MY_ORDERS_KEY, "{broken");
    expect(loadMyOrders(storage)).toEqual([]);
    const broken = memoryStorage(true);
    expect(rememberOrder(broken, order(1))).toEqual([order(1)]);
    expect(loadMyOrders(broken)).toEqual([]);
    expect(loadMyOrders(undefined)).toEqual([]);
  });
});

describe("status steps", () => {
  it("places happy-path statuses and leaves the others out", () => {
    expect(stepIndex("pending")).toBe(0);
    expect(stepIndex("served")).toBe(4);
    expect(stepIndex("rejected")).toBe(-1);
    expect(stepIndex("cancelled")).toBe(-1);
  });
});

describe("pickup tracking", () => {
  it("ends the steps in «picked_up» instead of «served»", () => {
    expect(customerSteps("pickup")).toEqual(["pending", "accepted", "preparing", "ready", "picked_up"]);
    expect(customerSteps("dine_in").at(-1)).toBe("served");
    expect(stepIndex("picked_up", "pickup")).toBe(4);
    expect(stepIndex("served", "pickup")).toBe(-1);
    expect(stepIndex("ready", "pickup")).toBe(3);
  });

  it("tells a pickup customer to come for the order, and a table customer that it is on its way", () => {
    expect(customerStatusHint("ready", "pickup")).toBe("¡Tu pedido está listo! Ya puedes retirarlo.");
    expect(customerStatusHint("ready", "dine_in")).toBe("Tu pedido está listo. Ya te lo llevan a la mesa.");
    expect(customerStatusHint("picked_up", "pickup")).toBeDefined();
    expect(customerStatusHint("rejected", "pickup")).toBe("El local no pudo tomar tu pedido.");
  });

  it("shows the estimated time only while the order is accepted or in the kitchen", () => {
    const eta = "2026-10-07T12:30:00.000Z";
    expect(showsReadyEstimate({ status: "accepted", estimatedReadyAt: eta })).toBe(true);
    expect(showsReadyEstimate({ status: "preparing", estimatedReadyAt: eta })).toBe(true);
    expect(showsReadyEstimate({ status: "ready", estimatedReadyAt: eta })).toBe(false);
    expect(showsReadyEstimate({ status: "picked_up", estimatedReadyAt: eta })).toBe(false);
    expect(showsReadyEstimate({ status: "accepted", estimatedReadyAt: null })).toBe(false);
  });
});

describe("delivery tracking", () => {
  it("adds the road to the steps", () => {
    expect(customerSteps("delivery")).toEqual(["pending", "accepted", "preparing", "ready", "out_for_delivery", "delivered"]);
    expect(stepIndex("out_for_delivery", "delivery")).toBe(4);
    expect(stepIndex("out_for_delivery", "pickup")).toBe(-1);
  });

  it("speaks of the road and the arrival", () => {
    expect(customerStatusHint("out_for_delivery", "delivery")).toBe("Tu pedido va en camino.");
    expect(customerStatusHint("ready", "delivery")).toMatch(/sale a reparto/);
    expect(customerStatusHint("ready", "pickup")).toMatch(/retirarlo/);
    expect(estimateLabel("delivery")).toBe("Llega aprox.");
    expect(estimateLabel("pickup")).toBe("Listo aprox.");
  });

  it("keeps the arrival time until it is delivered", () => {
    const eta = "2026-10-07T12:30:00.000Z";
    expect(showsReadyEstimate({ status: "ready", estimatedReadyAt: eta, channel: "delivery" })).toBe(true);
    expect(showsReadyEstimate({ status: "out_for_delivery", estimatedReadyAt: eta, channel: "delivery" })).toBe(true);
    expect(showsReadyEstimate({ status: "delivered", estimatedReadyAt: eta, channel: "delivery" })).toBe(false);
    expect(showsReadyEstimate({ status: "ready", estimatedReadyAt: eta, channel: "pickup" })).toBe(false);
  });
});
