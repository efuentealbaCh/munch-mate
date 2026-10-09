import { describe, expect, it } from "vitest";
import {
  checkoutSchema,
  deliveryCheckoutSchema,
  deliveryZoneSchema,
  itemsLimitSchema,
  modifierGroupSchema,
  pickupCheckoutSchema,
  productSchema,
  restaurantProfileSchema,
  statusReasonSchema,
  tableSchema,
} from "./validation";

const option = (name: string, priceDelta = "0") => ({ name, priceDelta, available: true });

function messages(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  return (result.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("modifierGroupSchema", () => {
  it("accepts a required single-choice group", () => {
    const result = modifierGroupSchema.safeParse({
      name: "Tamaño",
      minSelect: 1,
      maxSelect: 1,
      options: [option("Chico"), option("Grande", "800")],
    });
    expect(messages(result)).toEqual([]);
  });

  it("rejects rules the options cannot satisfy, on the max field", () => {
    const tooMany = modifierGroupSchema.safeParse({ name: "Extras", minSelect: 0, maxSelect: 3, options: [option("Palta")] });
    expect(messages(tooMany)).toEqual(["maxSelect: El máximo (3) no puede superar la cantidad de opciones (1)"]);

    const inverted = modifierGroupSchema.safeParse({
      name: "Extras",
      minSelect: 2,
      maxSelect: 1,
      options: [option("Palta"), option("Tomate")],
    });
    expect(messages(inverted)).toEqual(["maxSelect: El máximo de opciones no puede ser menor que el mínimo"]);
  });

  it("requires options, a max of at least 1 and valid extra prices", () => {
    expect(messages(modifierGroupSchema.safeParse({ name: "X", minSelect: 0, maxSelect: 1, options: [] }))).toContain(
      "options: Agrega al menos una opción",
    );
    expect(
      messages(modifierGroupSchema.safeParse({ name: "X", minSelect: 0, maxSelect: 0, options: [option("A")] })),
    ).toContain("maxSelect: El mínimo es 1");
    expect(
      messages(modifierGroupSchema.safeParse({ name: "X", minSelect: 0, maxSelect: 1, options: [option("A", "1,5")] })),
    ).toContain("options.0.priceDelta: Usa solo números, ej. 3.990");
  });
});

describe("productSchema", () => {
  const base = { categoryId: "c1", name: "Barros Luco", description: "", visible: true, modifierGroupIds: [] };

  it("accepts prices typed with or without thousands separators", () => {
    expect(productSchema.safeParse({ ...base, price: "3.990" }).success).toBe(true);
    expect(productSchema.safeParse({ ...base, price: "3990" }).success).toBe(true);
  });

  it("explains empty, invalid and too large prices", () => {
    expect(messages(productSchema.safeParse({ ...base, price: "" }))).toEqual(["price: Ingresa el precio"]);
    expect(messages(productSchema.safeParse({ ...base, price: "3,5" }))).toEqual(["price: Usa solo números, ej. 3.990"]);
    expect(messages(productSchema.safeParse({ ...base, price: "10.000.001" }))).toEqual(["price: El máximo es 10.000.000"]);
  });
});

describe("restaurantProfileSchema", () => {
  it("accepts Chilean phones and an empty phone (clears it)", () => {
    expect(restaurantProfileSchema.safeParse({ description: "", phone: "+56 9 1234 5678" }).success).toBe(true);
    expect(restaurantProfileSchema.safeParse({ description: "", phone: "" }).success).toBe(true);
    expect(restaurantProfileSchema.safeParse({ description: "", phone: "+569 12345678" }).success).toBe(true);
    expect(restaurantProfileSchema.safeParse({ description: "", phone: "   " }).success).toBe(true);
    expect(restaurantProfileSchema.safeParse({ description: "", phone: "llámame" }).success).toBe(false);
  });

  it("uses the api's rules (normalizePhone): too short or with text is rejected with an example", () => {
    const result = restaurantProfileSchema.safeParse({ description: "", phone: "123456" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Revisa el teléfono, ej. +569 12345678");
  });
});

describe("pickupCheckoutSchema", () => {
  const valid = { customerName: "Ana Pérez", customerPhone: "9 1234 5678", customerEmail: "", note: "" };
  const firstError = (values: Record<string, string>) => {
    const result = pickupCheckoutSchema.safeParse({ ...valid, ...values });
    return result.success ? null : (result.error.issues[0]?.message ?? "?");
  };

  it("accepts name and phone with an optional email, trimming everything", () => {
    const result = pickupCheckoutSchema.parse({ ...valid, customerName: "  Ana  ", customerEmail: "  ana@correo.cl " });
    expect(result.customerName).toBe("Ana");
    expect(result.customerEmail).toBe("ana@correo.cl");
    expect(pickupCheckoutSchema.parse({ ...valid, customerEmail: "   " }).customerEmail).toBe("");
  });

  it("requires a name of 2 to 60 characters", () => {
    expect(firstError({ customerName: " A " })).toBe("Ingresa tu nombre para que te entreguen el pedido");
    expect(firstError({ customerName: "x".repeat(61) })).toMatch(/hasta 60/);
  });

  it("checks the phone with the same rules as the api (normalizePhone)", () => {
    for (const phone of ["+56 9 1234 5678", "+569 12345678", "912345678", "(+56) 9 1234-5678", "22345678", "+54 9 11 2345 6789"]) {
      expect(firstError({ customerPhone: phone }), phone).toBeNull();
    }
    expect(firstError({ customerPhone: "" })).toBe("Ingresa tu teléfono");
    for (const phone of ["1234", "llámame", "+56 9 1234 5678 ext 2", "1".repeat(16)]) {
      expect(firstError({ customerPhone: phone }), phone).toBe("Revisa el teléfono, ej. +569 12345678");
    }
  });

  it("rejects a malformed email and a long comment", () => {
    expect(firstError({ customerEmail: "ana@" })).toBe("Ingresa un correo válido o déjalo en blanco");
    expect(firstError({ note: "x".repeat(201) })).toMatch(/hasta 200/);
  });
});

describe("deliveryCheckoutSchema", () => {
  const zones = [
    { id: "z1", name: "Ñuñoa", fee: 1990, minOrder: 8000, isHome: true, area: null },
    { id: "z2", name: "Centro", fee: 0, minOrder: 0, isHome: false, area: null },
  ];
  const schema = (subtotal: number) => deliveryCheckoutSchema({ subtotal, zones, currency: "CLP" });
  const valid = {
    customerName: "Ana",
    customerPhone: "9 1234 5678",
    customerEmail: "",
    note: "",
    zoneId: "z1",
    address: "Av. Italia 1234",
    unit: "",
    reference: "",
    paymentMethod: "cash" as const,
    cashAmount: "",
  };

  it("accepts a complete order, with or without the cash amount", () => {
    expect(schema(15000).safeParse(valid).success).toBe(true);
    expect(schema(15000).safeParse({ ...valid, cashAmount: "20.000" }).success).toBe(true);
    expect(schema(15000).safeParse({ ...valid, paymentMethod: "transfer", cashAmount: "1" }).success).toBe(true);
  });

  it("requires the zone, the address and the payment method", () => {
    expect(messages(schema(15000).safeParse({ ...valid, zoneId: "", address: " 1 ", paymentMethod: "" }))).toEqual([
      "zoneId: Elige tu comuna o zona",
      "address: Indica la calle y el número",
      "paymentMethod: Elige cómo vas a pagar",
    ]);
  });

  it("rejects an unknown zone and a subtotal below the zone minimum (fee not counted)", () => {
    expect(messages(schema(15000).safeParse({ ...valid, zoneId: "gone" }))).toEqual(["zoneId: Esta zona ya no está disponible. Elige otra."]);
    expect(messages(schema(7999).safeParse(valid))).toEqual(["zoneId: El pedido mínimo para Ñuñoa es $8.000 (sin el envío)"]);
    expect(schema(8000).safeParse(valid).success).toBe(true);
  });

  it("checks the cash covers subtotal + fee", () => {
    // 15.000 + 1.990 = 16.990
    expect(messages(schema(15000).safeParse({ ...valid, cashAmount: "16.000" }))).toEqual(["cashAmount: Debe cubrir el total ($16.990)"]);
    expect(schema(15000).safeParse({ ...valid, cashAmount: "16990" }).success).toBe(true);
    expect(messages(schema(15000).safeParse({ ...valid, cashAmount: "veinte" }))).toEqual(["cashAmount: Usa solo números, ej. 20.000"]);
  });
});

describe("deliveryZoneSchema", () => {
  it("accepts a zone with free shipping and no minimum", () => {
    expect(deliveryZoneSchema.safeParse({ name: "Centro", fee: "0", minOrder: "0", active: true, isHome: false }).success).toBe(true);
  });

  it("requires a name and valid amounts", () => {
    expect(messages(deliveryZoneSchema.safeParse({ name: " ", fee: "", minOrder: "1,5", active: true, isHome: false }))).toEqual([
      "name: Ingresa la comuna o sector, ej. Providencia",
      "fee: Ingresa el costo de envío (0 si es gratis)",
      "minOrder: Usa solo números, ej. 3.990",
    ]);
    expect(messages(deliveryZoneSchema.safeParse({ name: "X", fee: "2.000.000", minOrder: "0", active: true, isHome: false }))).toEqual([
      "fee: El máximo es 1.000.000",
    ]);
  });
});

describe("statusReasonSchema (reject and cancel)", () => {
  it("requires 1 to 200 characters, trimmed", () => {
    expect(statusReasonSchema.parse({ reason: "  Cocina saturada " }).reason).toBe("Cocina saturada");
    expect(statusReasonSchema.safeParse({ reason: "   " }).error?.issues[0]?.message).toBe("Indica el motivo: el cliente lo verá");
    expect(statusReasonSchema.safeParse({ reason: "x".repeat(200) }).success).toBe(true);
    expect(statusReasonSchema.safeParse({ reason: "x".repeat(201) }).success).toBe(false);
  });
});

describe("free text is cleaned like the api before it is measured", () => {
  const ZWSP = String.fromCharCode(0x200b);
  const BOM = String.fromCharCode(0xfeff);
  const NL = String.fromCharCode(10);
  const TAB = String.fromCharCode(9);

  it("treats a required field of blanks and invisible characters as empty", () => {
    const product = { categoryId: "c1", name: `${ZWSP} ${BOM}`, description: "", price: "1000", visible: true, modifierGroupIds: [] };
    expect(productSchema.safeParse(product).error?.issues[0]?.message).toBe("Ingresa un nombre");
    expect(statusReasonSchema.safeParse({ reason: `${NL}${ZWSP}${TAB} ${NL}` }).error?.issues[0]?.message).toBe(
      "Indica el motivo: el cliente lo verá",
    );
    expect(tableSchema.safeParse({ label: ` ${BOM} ` }).error?.issues[0]?.message).toBe("Ingresa un nombre, ej. Mesa 4");
    const pickup = { customerName: `A${ZWSP}${ZWSP}`, customerPhone: "912345678", customerEmail: "", note: "" };
    expect(pickupCheckoutSchema.safeParse(pickup).success).toBe(false);
  });

  it("collapses inner spaces in single-line fields and returns the cleaned value", () => {
    expect(tableSchema.parse({ label: `  Mesa ${ZWSP}   4 ` }).label).toBe("Mesa 4");
    expect(checkoutSchema.parse({ customerName: ` Ana ${NL}  Pérez `, note: "" }).customerName).toBe("Ana Pérez");
  });

  it("keeps line breaks in comments but at most one blank line, and counts the cleaned text", () => {
    const note = checkoutSchema.parse({ customerName: "", note: `sin cebolla${NL.repeat(4)}por favor  ` }).note;
    expect(note).toBe(`sin cebolla${NL}${NL}por favor`);
    // 200 characters plus padding and invisibles: within the limit once cleaned, as the api measures it.
    const padded = `   ${"x".repeat(100)}${ZWSP.repeat(50)}${"y".repeat(100)}   `;
    expect(checkoutSchema.safeParse({ customerName: "", note: padded }).success).toBe(true);
    expect(checkoutSchema.safeParse({ customerName: "", note: "x".repeat(201) }).success).toBe(false);
  });
});

describe("itemsLimitSchema", () => {
  it("accepts whole numbers from 1 to 500", () => {
    for (const value of [1, 50, 500]) expect(itemsLimitSchema.safeParse({ maxItemsPerOrder: value }).success, String(value)).toBe(true);
  });

  it("rejects out of range, decimals and empty input", () => {
    const message = (value: number) => itemsLimitSchema.safeParse({ maxItemsPerOrder: value }).error?.issues[0]?.message;
    expect(message(0)).toBe("El mínimo es 1 producto por pedido");
    expect(message(501)).toBe("El máximo es 500 productos por pedido");
    expect(message(2.5)).toBe("Usa un número entero");
    // An empty number input arrives as NaN (valueAsNumber).
    expect(message(Number.NaN)).toBe("Ingresa un número");
  });
});
