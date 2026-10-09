import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { listPreview, nameTakenFromError, nameTakenMessage, planBulkTables } from "./unique-names";

const tables = [
  { id: "t1", name: "Mesa 1" },
  { id: "t2", name: "Terraza Ñuñoa" },
];

describe("nameTakenMessage", () => {
  it("catches a repeated name ignoring case, accents and extra spaces, quoting the existing one", () => {
    expect(nameTakenMessage("table", "  mesa   1 ", tables)).toBe("Ya tienes una mesa llamada «Mesa 1»");
    expect(nameTakenMessage("zone", "terraza nunoa", tables)).toBe("Ya tienes una zona llamada «Terraza Ñuñoa»");
    expect(nameTakenMessage("category", "MESA 1", tables)).toBe("Ya tienes una categoría llamada «Mesa 1»");
    expect(nameTakenMessage("product", "Mesa 1", tables)).toBe("Ya hay un producto llamado «Mesa 1» en esta categoría");
  });

  it("lets the edited item keep (or re-case) its own name", () => {
    expect(nameTakenMessage("table", "MESA 1", tables, "t1")).toBeNull();
    expect(nameTakenMessage("table", "Terraza Ñuñoa", tables, "t1")).toBe("Ya tienes una mesa llamada «Terraza Ñuñoa»");
  });

  it("accepts new names and leaves blank names to the schema", () => {
    expect(nameTakenMessage("table", "Mesa 10", tables)).toBeNull();
    expect(nameTakenMessage("table", "   ", [{ id: "x", name: "" }])).toBeNull();
  });
});

describe("nameTakenFromError", () => {
  it("returns the api's message for the 409 of the same kind only", () => {
    const taken = new ApiError(409, "TABLE_LABEL_TAKEN", "Ya tienes una mesa llamada «Mesa 1»; usa otro nombre");
    expect(nameTakenFromError("table", taken)).toBe("Ya tienes una mesa llamada «Mesa 1»; usa otro nombre");
    expect(nameTakenFromError("zone", taken)).toBeNull();
    expect(nameTakenFromError("table", new ApiError(400, "VALIDATION_FAILED", "x"))).toBeNull();
    expect(nameTakenFromError("table", new Error("red"))).toBeNull();
  });
});

describe("planBulkTables", () => {
  it("skips labels already in use and keeps the rest in order", () => {
    expect(planBulkTables(["Mesa 1", "Mesa 2", "Mesa 3"], ["mesa  1", " MESA 3"])).toEqual({
      create: ["Mesa 2"],
      skipped: ["Mesa 1", "Mesa 3"],
    });
  });

  it("skips labels repeated within the batch itself", () => {
    expect(planBulkTables(["Mesa 1", "mesa 1", "Mésa 2"], ["Mesa 2"])).toEqual({ create: ["Mesa 1"], skipped: ["mesa 1", "Mésa 2"] });
  });
});

describe("listPreview", () => {
  it("joins a few names and summarizes long lists", () => {
    expect(listPreview(["Mesa 1"])).toBe("Mesa 1");
    expect(listPreview(["Mesa 1", "Mesa 2", "Mesa 3"])).toBe("Mesa 1, Mesa 2 y Mesa 3");
    expect(listPreview(["1", "2", "3", "4", "5", "6", "7"])).toBe("1, 2, 3, 4, 5 y 2 más");
  });
});
