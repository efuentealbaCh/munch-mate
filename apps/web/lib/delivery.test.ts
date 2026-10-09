import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "./cart";
import {
  addressLine,
  cashChange,
  customerPaymentLabel,
  DELIVERY_CONTACT_KEY,
  defaultZoneId,
  deliveryTotals,
  expectedPaymentLabel,
  loadDeliveryContact,
  mapsSearchUrl,
  methodsExpectedFirst,
  onlineChannels,
  resolveChannel,
  saveDeliveryContact,
  zoneOptionLabel,
} from "./delivery";

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

const zone = (id: string, overrides: Partial<{ fee: number; minOrder: number; isHome: boolean; name: string }> = {}) => ({
  id,
  name: overrides.name ?? `Zona ${id}`,
  fee: overrides.fee ?? 1990,
  minOrder: overrides.minOrder ?? 0,
  isHome: overrides.isHome ?? false,
});

describe("channel choice", () => {
  it("offers the enabled channels, pickup first", () => {
    expect(onlineChannels({ pickupEnabled: true, deliveryEnabled: true })).toEqual(["pickup", "delivery"]);
    expect(onlineChannels({ pickupEnabled: false, deliveryEnabled: true })).toEqual(["delivery"]);
    expect(onlineChannels({ pickupEnabled: false, deliveryEnabled: false })).toEqual([]);
  });

  it("keeps the customer's choice while offered, else falls back to the first one", () => {
    expect(resolveChannel("delivery", ["pickup", "delivery"])).toBe("delivery");
    expect(resolveChannel("delivery", ["pickup"])).toBe("pickup");
    expect(resolveChannel(null, ["delivery"])).toBe("delivery");
    expect(resolveChannel("pickup", [])).toBeNull();
  });
});

describe("zones and totals", () => {
  it("preselects the restaurant's own zone, else the first one", () => {
    expect(defaultZoneId([zone("a"), zone("b", { isHome: true })])).toBe("b");
    expect(defaultZoneId([zone("a"), zone("b")])).toBe("a");
    expect(defaultZoneId([])).toBe("");
  });

  it("adds the fee to the total and compares the minimum without it", () => {
    expect(deliveryTotals(7000, zone("a", { fee: 2000, minOrder: 8000 }))).toEqual({ subtotal: 7000, fee: 2000, total: 9000, missing: 1000 });
    expect(deliveryTotals(8000, zone("a", { fee: 2000, minOrder: 8000 })).missing).toBe(0);
    expect(deliveryTotals(5000, null)).toEqual({ subtotal: 5000, fee: 0, total: 5000, missing: 0 });
  });

  it("computes the change only when the cash covers the total", () => {
    expect(cashChange(16990, 20000)).toBe(3010);
    expect(cashChange(16990, 16990)).toBe(0);
    expect(cashChange(16990, 10000)).toBeNull();
    expect(cashChange(16990, null)).toBeNull();
    expect(cashChange(16990, undefined)).toBeNull();
  });

  it("labels zones for the picker", () => {
    expect(zoneOptionLabel(zone("a", { name: "Ñuñoa", fee: 1990, minOrder: 8000 }), "CLP")).toBe("Ñuñoa · envío $1.990 · mínimo $8.000");
    expect(zoneOptionLabel(zone("a", { name: "Centro", fee: 0 }), "CLP")).toBe("Centro · envío gratis");
  });
});

describe("address and payment wording", () => {
  const delivery = { zoneId: "z", zoneName: "Ñuñoa", address: "Av. Italia 1234", unit: "Depto 402", reference: "portón verde" };

  it("joins street and unit", () => {
    expect(addressLine(delivery)).toBe("Av. Italia 1234, Depto 402");
    expect(addressLine({ ...delivery, unit: "" })).toBe("Av. Italia 1234");
  });

  it("builds a maps search with the address and the zone", () => {
    const url = new URL(mapsSearchUrl(delivery));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/search/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("query")).toBe("Av. Italia 1234, Ñuñoa");
  });

  it("describes the expected payment for staff and customer", () => {
    const cash = { method: "cash" as const, cashAmount: 20000, change: 3010 };
    expect(expectedPaymentLabel(cash, "CLP")).toBe("Efectivo · paga con $20.000 · vuelto $3.010");
    expect(customerPaymentLabel(cash, "CLP")).toBe("Efectivo (pagas con $20.000, vuelto $3.010)");
    expect(customerPaymentLabel({ ...cash, change: 0 }, "CLP")).toBe("Efectivo (pagas con $20.000, monto exacto)");
    expect(expectedPaymentLabel({ method: "cash", cashAmount: null, change: null }, "CLP")).toBe("Efectivo");
    expect(customerPaymentLabel({ method: "transfer", cashAmount: null, change: null }, "CLP")).toBe("Transferencia");
  });

  it("puts the announced method first", () => {
    expect(methodsExpectedFirst(["cash", "card_pos", "transfer"], "transfer")).toEqual(["transfer", "cash", "card_pos"]);
    expect(methodsExpectedFirst(["cash", "card_pos", "transfer"], null)).toEqual(["cash", "card_pos", "transfer"]);
  });
});

describe("contact remembered on the device", () => {
  const contact = {
    customerName: "Ana",
    customerPhone: "+56912345678",
    customerEmail: "",
    zoneId: "z1",
    address: " Av. Italia 1234 ",
    unit: "",
    reference: "portón verde",
  };

  it("round-trips (trimmed) and ignores malformed data", () => {
    const storage = memoryStorage();
    saveDeliveryContact(storage, contact);
    expect(loadDeliveryContact(storage)).toEqual({ ...contact, address: "Av. Italia 1234" });
    storage.data.set(DELIVERY_CONTACT_KEY, "{oops");
    expect(loadDeliveryContact(storage)).toBeNull();
    storage.data.set(DELIVERY_CONTACT_KEY, JSON.stringify({ customerName: 42 }));
    expect(loadDeliveryContact(storage)?.customerName).toBe("");
  });

  it("never throws when storage is unavailable", () => {
    const broken = memoryStorage(true);
    expect(() => saveDeliveryContact(broken, contact)).not.toThrow();
    expect(loadDeliveryContact(broken)).toBeNull();
    expect(loadDeliveryContact(undefined)).toBeNull();
  });
});
