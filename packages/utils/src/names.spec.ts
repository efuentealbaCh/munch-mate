import { isNameTaken, nameKey } from "./names";

describe("nameKey", () => {
  it("ignores case, accents and extra spaces", () => {
    expect(nameKey("  Mesa   1 ")).toBe("mesa 1");
    expect(nameKey("ÑUÑOA")).toBe(nameKey("Nunoa"));
    expect(nameKey("Café con leche")).toBe(nameKey("cafe CON leche"));
  });

  it("keeps different names apart", () => {
    expect(nameKey("Mesa 1")).not.toBe(nameKey("Mesa 10"));
  });
});

describe("isNameTaken", () => {
  const existing = [
    { id: "a", name: "Mesa 1" },
    { id: "b", name: "Terraza" },
  ];

  it("detects a duplicate written differently", () => {
    expect(isNameTaken("mesa  1", existing)).toBe(true);
    expect(isNameTaken("TERRAZA", existing)).toBe(true);
    expect(isNameTaken("Mesa 2", existing)).toBe(false);
  });

  it("lets an item keep its own name when renamed", () => {
    expect(isNameTaken("MESA 1", existing, "a")).toBe(false);
    expect(isNameTaken("Terraza", existing, "a")).toBe(true);
  });

  it("lets an old duplicate keep its name, but not take another one", () => {
    const legacy = [
      { id: "a", name: "Providencia" },
      { id: "b", name: "providencia" },
      { id: "c", name: "La Reina" },
    ];
    expect(isNameTaken("Providencia", legacy, "b")).toBe(false);
    expect(isNameTaken("La Reina", legacy, "b")).toBe(true);
  });
});
