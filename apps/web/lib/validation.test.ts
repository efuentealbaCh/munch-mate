import { describe, expect, it } from "vitest";
import { modifierGroupSchema, pickupCheckoutSchema, productSchema, restaurantProfileSchema } from "./validation";

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
    expect(restaurantProfileSchema.safeParse({ description: "", phone: "llámame" }).success).toBe(false);
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
    for (const phone of ["+56 9 1234 5678", "912345678", "(+56) 9 1234-5678", "22345678", "+54 9 11 2345 6789"]) {
      expect(firstError({ customerPhone: phone }), phone).toBeNull();
    }
    expect(firstError({ customerPhone: "" })).toBe("Ingresa tu teléfono");
    for (const phone of ["1234", "llámame", "+56 9 1234 5678 ext 2", "1".repeat(16)]) {
      expect(firstError({ customerPhone: phone }), phone).toBe("Revisa el teléfono, ej. +56 9 1234 5678");
    }
  });

  it("rejects a malformed email and a long comment", () => {
    expect(firstError({ customerEmail: "ana@" })).toBe("Ingresa un correo válido o déjalo en blanco");
    expect(firstError({ note: "x".repeat(201) })).toMatch(/hasta 200/);
  });
});
