import { MENU_LIMITS } from "@app/types";
import { describe, expect, it } from "vitest";
import {
  canManageAvailability,
  groupProductsByCategory,
  imageDimensionsProblem,
  imageFileProblem,
  modifierRuleSummary,
  modifierRulesProblem,
  moveItem,
} from "./menu";

describe("groupProductsByCategory", () => {
  const categories = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];

  it("keeps the category order and the product order inside each category", () => {
    const products = [
      { id: "p1", categoryId: "c2" },
      { id: "p2", categoryId: "c1" },
      { id: "p3", categoryId: "c2" },
    ];
    const grouped = groupProductsByCategory(categories, products);
    expect(grouped.map((g) => [g.category.id, g.products.map((p) => p.id)])).toEqual([
      ["c1", ["p2"]],
      ["c2", ["p1", "p3"]],
      ["c3", []],
    ]);
  });

  it("drops products of unknown categories", () => {
    const grouped = groupProductsByCategory(categories, [{ id: "p1", categoryId: "zz" }]);
    expect(grouped.flatMap((g) => g.products)).toEqual([]);
  });
});

describe("modifierRuleSummary", () => {
  it("describes required and optional groups in plain Spanish", () => {
    expect(modifierRuleSummary(1, 1)).toBe("Obligatorio · elige 1");
    expect(modifierRuleSummary(2, 2)).toBe("Obligatorio · elige 2");
    expect(modifierRuleSummary(1, 3)).toBe("Obligatorio · elige de 1 a 3");
    expect(modifierRuleSummary(0, 3)).toBe("Opcional · hasta 3");
    expect(modifierRuleSummary(0, 1)).toBe("Opcional · hasta 1");
  });
});

describe("modifierRulesProblem", () => {
  it("mirrors the api rules", () => {
    expect(modifierRulesProblem(1, 1, 2)).toBeNull();
    expect(modifierRulesProblem(0, 2, 2)).toBeNull();
    expect(modifierRulesProblem(2, 1, 3)).toMatch(/no puede ser menor que el mínimo/);
    expect(modifierRulesProblem(0, 3, 2)).toBe("El máximo (3) no puede superar la cantidad de opciones (2)");
  });
});

describe("moveItem", () => {
  it("moves an element and leaves the input untouched", () => {
    const items = ["a", "b", "c"];
    expect(moveItem(items, 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(items, 0, 1)).toEqual(["b", "a", "c"]);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("ignores moves outside the list", () => {
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 2)).toEqual(["a", "b"]);
  });
});

describe("canManageAvailability", () => {
  it("allows owners, cashiers and kitchen staff only", () => {
    expect(canManageAvailability(["kitchen"])).toBe(true);
    expect(canManageAvailability(["cashier", "rider"])).toBe(true);
    expect(canManageAvailability(["owner"])).toBe(true);
    expect(canManageAvailability(["rider"])).toBe(false);
  });
});

describe("image validation", () => {
  it("accepts the supported types up to the size limit", () => {
    expect(imageFileProblem({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(imageFileProblem({ type: "image/avif", size: MENU_LIMITS.imageMaxBytes })).toBeNull();
  });

  it("rejects other types, empty files and files over 8 MB", () => {
    expect(imageFileProblem({ type: "image/gif", size: 1000 })).toMatch(/JPG, PNG, WebP o AVIF/);
    expect(imageFileProblem({ type: "", size: 1000 })).toMatch(/JPG/);
    expect(imageFileProblem({ type: "image/png", size: MENU_LIMITS.imageMaxBytes + 1 })).toMatch(/más de 8 MB/);
    expect(imageFileProblem({ type: "image/png", size: 0 })).toMatch(/vacío/);
  });

  it("requires at least 200 px per side", () => {
    expect(imageDimensionsProblem(200, 200)).toBeNull();
    expect(imageDimensionsProblem(1200, 199)).toMatch(/al menos 200×200/);
  });
});
