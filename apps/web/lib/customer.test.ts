import { CUSTOMER_LIMITS, type CustomerOrderSummary, ORDER_LIMITS, type SavedAddressView } from "@app/types";
import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "./cart";
import {
  appendOrdersPage,
  canOfferSaveAddress,
  findSavedAddress,
  hasSessionHint,
  historyTone,
  itemCountLabel,
  prefillContact,
  SESSION_HINT_KEY,
  savedAddressLine,
  savedAddressToCheckout,
  setSessionHint,
  suggestAddressLabel,
  toSavedAddressInput,
} from "./customer";

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

function saved(overrides: Partial<SavedAddressView> = {}): SavedAddressView {
  return {
    id: "a1",
    label: "Casa",
    address: "Av. Italia 1234",
    unit: "Depto 402",
    reference: "Portón verde",
    location: { lat: -33.45, lng: -70.62 },
    createdAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

function summary(token: string): CustomerOrderSummary {
  return {
    trackingToken: token,
    restaurant: { name: "Fuente Alemana", slug: "fuente-alemana" },
    number: 1,
    ticketNumber: 1,
    channel: "pickup",
    status: "pending",
    total: 5000,
    currency: "CLP",
    itemCount: 1,
    createdAt: "2026-10-01T12:00:00.000Z",
  };
}

describe("session hint", () => {
  it("is set and cleared", () => {
    const storage = memoryStorage();
    expect(hasSessionHint(storage)).toBe(false);
    setSessionHint(storage, true);
    expect(storage.data.get(SESSION_HINT_KEY)).toBe("1");
    expect(hasSessionHint(storage)).toBe(true);
    setSessionHint(storage, false);
    expect(hasSessionHint(storage)).toBe(false);
  });

  it("treats unavailable storage as a guest", () => {
    expect(hasSessionHint(memoryStorage(true))).toBe(false);
    expect(hasSessionHint(undefined)).toBe(false);
    expect(() => setSessionHint(memoryStorage(true), true)).not.toThrow();
  });
});

describe("prefillContact", () => {
  const profile = { name: "Ana Pérez", phone: "+56912345678" };

  it("fills empty fields from the account, phone formatted", () => {
    expect(prefillContact({ customerName: "", customerPhone: "", note: "x" }, profile)).toEqual({
      customerName: "Ana Pérez",
      customerPhone: "+569 12345678",
      note: "x",
    });
  });

  it("never overwrites what was typed or remembered on the device", () => {
    expect(prefillContact({ customerName: "Anita", customerPhone: "+569 87654321" }, profile)).toEqual({
      customerName: "Anita",
      customerPhone: "+569 87654321",
    });
    // Only the empty one is filled.
    expect(prefillContact({ customerName: "Anita", customerPhone: " " }, profile).customerPhone).toBe("+569 12345678");
  });

  it("leaves the phone empty when the account has none", () => {
    expect(prefillContact({ customerName: "", customerPhone: "" }, { name: "Ana", phone: "" }).customerPhone).toBe("");
  });

  it("works for the table checkout, which has no phone field", () => {
    const filled = prefillContact({ customerName: "", note: "" }, profile);
    expect(filled).toEqual({ customerName: "Ana Pérez", note: "" });
    expect("customerPhone" in filled).toBe(false);
  });

  it("cuts a long account name to the order's limit", () => {
    const filled = prefillContact({ customerName: "" }, { name: "x".repeat(200), phone: "" });
    expect(filled.customerName).toHaveLength(ORDER_LIMITS.customerNameMax);
  });
});

describe("saved addresses at checkout", () => {
  it("maps a saved address to the checkout fields and its pin", () => {
    expect(savedAddressToCheckout(saved())).toEqual({
      address: "Av. Italia 1234",
      unit: "Depto 402",
      reference: "Portón verde",
      location: { lat: -33.45, lng: -70.62 },
    });
    expect(savedAddressToCheckout(saved({ location: null })).location).toBeNull();
  });

  it("formats the line with the unit when there is one", () => {
    expect(savedAddressLine(saved())).toBe("Av. Italia 1234, Depto 402");
    expect(savedAddressLine(saved({ unit: "" }))).toBe("Av. Italia 1234");
  });

  it("recognizes the address being shown regardless of case and spacing", () => {
    const list = [saved(), saved({ id: "a2", label: "Trabajo", address: "Providencia 100", unit: "" })];
    expect(findSavedAddress(list, { address: "av.  italia 1234 ", unit: "depto 402" })?.id).toBe("a1");
    expect(findSavedAddress(list, { address: "Providencia 100", unit: "" })?.id).toBe("a2");
    expect(findSavedAddress(list, { address: "Av. Italia 1234", unit: "" })).toBeUndefined();
  });

  it("offers saving only new, real addresses while there is room", () => {
    const list = [saved()];
    expect(canOfferSaveAddress(list, { address: "Los Leones 50", unit: "" })).toBe(true);
    expect(canOfferSaveAddress(list, { address: "Av. Italia 1234", unit: "Depto 402" })).toBe(false);
    expect(canOfferSaveAddress(list, { address: "  ", unit: "" })).toBe(false);
    const full = Array.from({ length: CUSTOMER_LIMITS.addressesMax }, (_, i) => saved({ id: `a${i}`, address: `Calle ${i}` }));
    expect(canOfferSaveAddress(full, { address: "Los Leones 50", unit: "" })).toBe(false);
  });

  it("suggests a label that is still free", () => {
    expect(suggestAddressLabel([])).toBe("Casa");
    expect(suggestAddressLabel([{ label: "casa" }])).toBe("Trabajo");
    expect(suggestAddressLabel([{ label: "Casa" }, { label: "Trabajo" }, { label: "Otra" }])).toBe("Dirección 2");
    expect(suggestAddressLabel([{ label: "Casa" }, { label: "Trabajo" }, { label: "Otra" }, { label: "Dirección 2" }])).toBe("Dirección 3");
  });

  it("builds the api body: trimmed, empty optionals kept as '' (PUT replaces) and the pin or null", () => {
    expect(toSavedAddressInput({ label: " Casa ", address: " Av. Italia 1234 ", unit: "", reference: " " }, null)).toEqual({
      label: "Casa",
      address: "Av. Italia 1234",
      unit: "",
      reference: "",
      location: null,
    });
  });
});

describe("order history", () => {
  it("appends older pages without repeating orders", () => {
    const first = [summary("a"), summary("b")];
    const merged = appendOrdersPage(first, { items: [summary("b"), summary("c")], nextBefore: null });
    expect(merged.map((o) => o.trackingToken)).toEqual(["a", "b", "c"]);
  });

  it("tells active, finished and failed orders apart", () => {
    expect(historyTone("pending")).toBe("active");
    expect(historyTone("out_for_delivery")).toBe("active");
    expect(historyTone("picked_up")).toBe("done");
    expect(historyTone("served")).toBe("done");
    expect(historyTone("rejected")).toBe("failed");
    expect(historyTone("cancelled")).toBe("failed");
  });

  it("counts products", () => {
    expect(itemCountLabel(1)).toBe("1 producto");
    expect(itemCountLabel(3)).toBe("3 productos");
  });
});
