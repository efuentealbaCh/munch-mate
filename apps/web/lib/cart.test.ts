import type { PublicModifierGroup, PublicProduct } from "@app/types";
import { describe, expect, it } from "vitest";
import {
  blockedGroups,
  type CartLine,
  cartCount,
  cartReducer,
  cartTotal,
  checkoutFingerprint,
  createLine,
  deserializeCart,
  isOptionDisabled,
  type KeyValueStorage,
  lineTotal,
  loadCart,
  loadCheckoutAttempt,
  missingGroups,
  newClientOrderId,
  pickClientOrderId,
  pickupCartScope,
  resolveModifiers,
  saveCart,
  saveCheckoutAttempt,
  serializeCart,
  toggleOption,
  toOrderItems,
  unitPrice,
} from "./cart";

const size: PublicModifierGroup = {
  id: "g-size",
  name: "Tamaño",
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: "o-normal", name: "Normal", priceDelta: 0, available: true },
    { id: "o-big", name: "Grande", priceDelta: 800, available: true },
    { id: "o-xl", name: "XL", priceDelta: 1500, available: false },
  ],
};

const extras: PublicModifierGroup = {
  id: "g-extras",
  name: "Agregados",
  minSelect: 0,
  maxSelect: 2,
  options: [
    { id: "o-palta", name: "Palta", priceDelta: 900, available: true },
    { id: "o-queso", name: "Queso", priceDelta: 500, available: true },
    { id: "o-tomate", name: "Tomate", priceDelta: 300, available: true },
    { id: "o-tocino", name: "Tocino", priceDelta: 1000, available: false },
  ],
};

const product: PublicProduct = {
  id: "p-barros",
  name: "Barros Luco",
  description: "",
  price: 3990,
  available: true,
  image: null,
  modifierGroups: [size, extras],
};

/** Map-backed Storage, optionally failing like Safari private mode. */
function memoryStorage(fail = false): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const guard = () => {
    if (fail) throw new DOMException("QuotaExceededError");
  };
  return {
    data,
    getItem: (key) => (guard(), data.get(key) ?? null),
    setItem: (key, value) => (guard(), void data.set(key, value)),
    removeItem: (key) => (guard(), void data.delete(key)),
  };
}

describe("modifier selection", () => {
  it("radio groups replace the choice", () => {
    let selection = toggleOption({}, size, "o-normal", true);
    selection = toggleOption(selection, size, "o-big", true);
    expect(selection["g-size"]).toEqual(["o-big"]);
  });

  it("checkbox groups add and remove, never beyond maxSelect", () => {
    let selection = toggleOption({}, extras, "o-palta", true);
    selection = toggleOption(selection, extras, "o-queso", true);
    expect(toggleOption(selection, extras, "o-tomate", true)).toBe(selection);
    selection = toggleOption(selection, extras, "o-palta", false);
    expect(selection["g-extras"]).toEqual(["o-queso"]);
  });

  it("ignores sold-out and unknown options", () => {
    expect(toggleOption({}, size, "o-xl", true)).toEqual({});
    expect(toggleOption({}, extras, "nope", true)).toEqual({});
  });

  it("disables sold-out options and unchosen checkboxes once the maximum is reached", () => {
    const full = { "g-extras": ["o-palta", "o-queso"] };
    expect(isOptionDisabled(full, extras, "o-tomate")).toBe(true);
    expect(isOptionDisabled(full, extras, "o-palta")).toBe(false);
    expect(isOptionDisabled({}, extras, "o-tocino")).toBe(true);
    expect(isOptionDisabled({}, size, "o-xl")).toBe(true);
    // Radios never hit a maximum: picking another replaces the choice.
    expect(isOptionDisabled({ "g-size": ["o-normal"] }, size, "o-big")).toBe(false);
  });

  it("lists required groups that are still missing", () => {
    expect(missingGroups(product, {}).map((g) => g.id)).toEqual(["g-size"]);
    expect(missingGroups(product, { "g-size": ["o-big"] })).toEqual([]);
  });

  it("detects required groups that cannot be satisfied (everything sold out)", () => {
    const soldOut = { ...size, options: size.options.map((o) => ({ ...o, available: false })) };
    expect(blockedGroups({ modifierGroups: [soldOut, extras] }).map((g) => g.id)).toEqual(["g-size"]);
    expect(blockedGroups(product)).toEqual([]);
  });

  it("prices base + Σ deltas, in the product's group and option order", () => {
    const chosen = resolveModifiers(product, { "g-extras": ["o-queso", "o-palta"], "g-size": ["o-big"] });
    expect(chosen.map((m) => m.optionId)).toEqual(["o-big", "o-palta", "o-queso"]);
    expect(unitPrice(product.price, chosen)).toBe(3990 + 800 + 900 + 500);
  });
});

describe("cart", () => {
  const big = createLine(product, { "g-size": ["o-big"], "g-extras": ["o-palta"] }, 2, "  sin mayo ");

  it("builds lines with a trimmed note and line totals", () => {
    expect(big.note).toBe("sin mayo");
    expect(lineTotal(big)).toBe((3990 + 800 + 900) * 2);
  });

  it("merges identical lines and caps quantities at 20", () => {
    let cart = cartReducer([], { type: "add", line: big });
    cart = cartReducer(cart, { type: "add", line: { ...big, quantity: 19 } });
    expect(cart).toHaveLength(1);
    expect(cart[0]?.quantity).toBe(20);
  });

  it("keeps different options or notes as separate lines", () => {
    const normal = createLine(product, { "g-size": ["o-normal"] }, 1, "");
    const noted = createLine(product, { "g-size": ["o-big"], "g-extras": ["o-palta"] }, 1, "bien cocido");
    const cart = [big, normal, noted].reduce<CartLine[]>((c, line) => cartReducer(c, { type: "add", line }), []);
    expect(cart).toHaveLength(3);
    expect(cartCount(cart)).toBe(4);
    expect(cartTotal(cart)).toBe(lineTotal(big) + 3990 + (3990 + 800 + 900));
  });

  it("updates quantities within bounds and removes lines or whole products", () => {
    const other = createLine({ ...product, id: "p-other", modifierGroups: [] }, {}, 1, "");
    let cart: CartLine[] = [big, other];
    cart = cartReducer(cart, { type: "setQuantity", key: big.key, quantity: 0 });
    expect(cart[0]?.quantity).toBe(1);
    cart = cartReducer(cart, { type: "setQuantity", key: big.key, quantity: 99 });
    expect(cart[0]?.quantity).toBe(20);
    expect(cartReducer(cart, { type: "remove", key: other.key })).toHaveLength(1);
    expect(cartReducer(cart, { type: "removeProduct", productId: "p-barros" }).map((l) => l.productId)).toEqual(["p-other"]);
    expect(cartReducer(cart, { type: "clear" })).toEqual([]);
  });

  it("sends only ids and quantities, modifiers grouped by group", () => {
    const plain = createLine({ ...product, modifierGroups: [] }, {}, 1, "");
    expect(toOrderItems([big, plain])).toEqual([
      {
        productId: "p-barros",
        quantity: 2,
        modifiers: [
          { groupId: "g-size", optionIds: ["o-big"] },
          { groupId: "g-extras", optionIds: ["o-palta"] },
        ],
        note: "sin mayo",
      },
      { productId: "p-barros", quantity: 1, modifiers: [] },
    ]);
  });
});

describe("cart persistence", () => {
  const line = createLine(product, { "g-size": ["o-normal"] }, 3, "");

  it("round-trips through sessionStorage, keyed by table", () => {
    const storage = memoryStorage();
    saveCart(storage, "mesa-a", [line]);
    expect(loadCart(storage, "mesa-a")).toEqual([line]);
    expect(loadCart(storage, "mesa-b")).toEqual([]);
    saveCart(storage, "mesa-a", []);
    expect(storage.data.size).toBe(0);
  });

  it("discards malformed, foreign-version or tampered data", () => {
    expect(deserializeCart("{nope")).toEqual([]);
    expect(deserializeCart(JSON.stringify({ v: 999, lines: [line] }))).toEqual([]);
    const tampered = JSON.parse(serializeCart([line])) as { lines: Array<Record<string, unknown>> };
    tampered.lines.push({ ...tampered.lines[0], basePrice: -5 }, { ...tampered.lines[0], quantity: "3" });
    expect(deserializeCart(JSON.stringify(tampered))).toEqual([line]);
  });

  it("clamps stored quantities and recomputes the key", () => {
    const raw = JSON.parse(serializeCart([line])) as { lines: Array<Record<string, unknown>> };
    raw.lines[0] = { ...raw.lines[0], quantity: 500, key: "forged" };
    const [restored] = deserializeCart(JSON.stringify(raw));
    expect(restored?.quantity).toBe(20);
    expect(restored?.key).toBe(line.key);
  });

  it("never throws when storage is unavailable", () => {
    const broken = memoryStorage(true);
    expect(() => saveCart(broken, "t", [line])).not.toThrow();
    expect(loadCart(broken, "t")).toEqual([]);
    expect(loadCart(undefined, "t")).toEqual([]);
  });
});

describe("idempotent submission", () => {
  const items = toOrderItems([createLine(product, { "g-size": ["o-big"] }, 1, "")]);

  it("reuses the id for a retry of the same content and changes it for new content", () => {
    let n = 0;
    const makeId = () => `id-${++n}`;
    const first = pickClientOrderId(null, checkoutFingerprint({ items }), makeId);
    expect(first.clientOrderId).toBe("id-1");
    expect(pickClientOrderId(first, checkoutFingerprint({ items }), makeId)).toBe(first);
    const changed = pickClientOrderId(first, checkoutFingerprint({ items, customerName: "Ana" }), makeId);
    expect(changed.clientOrderId).toBe("id-2");
  });

  it("treats a delivery with another address or payment as a new submission", () => {
    const base = { items, customerName: "Ana", customerPhone: "+56912345678" };
    const delivery = {
      ...base,
      delivery: { zoneId: "z1", address: "Av. Italia 1234" },
      payment: { method: "cash" as const, cashAmount: 20000 },
    };
    expect(checkoutFingerprint(delivery)).toBe(checkoutFingerprint({ ...delivery }));
    expect(checkoutFingerprint(delivery)).not.toBe(checkoutFingerprint(base));
    expect(checkoutFingerprint(delivery)).not.toBe(checkoutFingerprint({ ...delivery, delivery: { zoneId: "z1", address: "Otra 1" } }));
    expect(checkoutFingerprint(delivery)).not.toBe(checkoutFingerprint({ ...delivery, payment: { method: "transfer" as const } }));
  });

  it("treats a pickup retry with other contact data as a new submission", () => {
    const pickup = { items, customerName: "Ana", customerPhone: "+56912345678" };
    expect(checkoutFingerprint(pickup)).toBe(checkoutFingerprint({ ...pickup }));
    expect(checkoutFingerprint(pickup)).not.toBe(checkoutFingerprint({ ...pickup, customerPhone: "+56987654321" }));
    expect(checkoutFingerprint(pickup)).not.toBe(checkoutFingerprint({ ...pickup, customerEmail: "ana@correo.cl" }));
    // Dine-in fingerprints keep their old shape (an attempt saved before this change still matches).
    expect(checkoutFingerprint({ items, customerName: "Ana" })).toBe(JSON.stringify([items, "Ana", ""]));
  });

  it("keeps pickup carts apart from table carts", () => {
    const storage = memoryStorage();
    const line = createLine(product, { "g-size": ["o-big"] }, 1, "");
    saveCart(storage, pickupCartScope("sangucheria"), [line]);
    expect(loadCart(storage, pickupCartScope("sangucheria"))).toHaveLength(1);
    expect(loadCart(storage, "sangucheria")).toEqual([]);
  });

  it("persists the attempt so a reload retries with the same id", () => {
    const storage = memoryStorage();
    const attempt = { clientOrderId: "abc", fingerprint: "f" };
    saveCheckoutAttempt(storage, "t", attempt);
    expect(loadCheckoutAttempt(storage, "t")).toEqual(attempt);
    saveCheckoutAttempt(storage, "t", null);
    expect(loadCheckoutAttempt(storage, "t")).toBeNull();
    expect(loadCheckoutAttempt(memoryStorage(true), "t")).toBeNull();
  });

  it("generates RFC 4122 v4 ids, also without crypto.randomUUID (insecure contexts)", () => {
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(newClientOrderId()).toMatch(v4);
    const withoutRandomUUID = { getRandomValues: crypto.getRandomValues.bind(crypto) } as Pick<Crypto, "getRandomValues">;
    const fallback = newClientOrderId(withoutRandomUUID);
    expect(fallback).toMatch(v4);
  });
});
