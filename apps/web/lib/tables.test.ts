import { describe, expect, it } from "vitest";
import { bulkLabels, createInOrder, namedTables, tableUrl } from "./tables";

describe("bulkLabels", () => {
  it("numbers a prefix over a range", () => {
    expect(bulkLabels("Mesa", 1, 3)).toEqual({ ok: true, labels: ["Mesa 1", "Mesa 2", "Mesa 3"] });
    expect(bulkLabels("  Terraza ", 9, 10)).toEqual({ ok: true, labels: ["Terraza 9", "Terraza 10"] });
    expect(bulkLabels("", 4, 5)).toEqual({ ok: true, labels: ["4", "5"] });
  });

  it("rejects reversed, oversized, non-integer and too-long ranges", () => {
    expect(bulkLabels("Mesa", 5, 1).ok).toBe(false);
    expect(bulkLabels("Mesa", 1, 51).ok).toBe(false);
    expect(bulkLabels("Mesa", 1.5, 3).ok).toBe(false);
    expect(bulkLabels("Mesa", -1, 3).ok).toBe(false);
    expect(bulkLabels("x".repeat(29), 1, 10).ok).toBe(false);
    expect(bulkLabels("Mesa", 1, 50).ok).toBe(true);
  });
});

describe("tableUrl", () => {
  it("builds the customer URL printed in the QR", () => {
    expect(tableUrl("https://munchmate.cl/", "abcd234567")).toBe("https://munchmate.cl/m/abcd234567");
  });
});

describe("createInOrder", () => {
  const taken = (error: unknown) => error instanceof Error && error.message === "taken";

  it("creates in order and skips labels the api says are taken, without stopping", async () => {
    const calls: string[] = [];
    const progress: number[] = [];
    const result = await createInOrder(
      ["Mesa 1", "Mesa 2", "Mesa 3"],
      async (label) => {
        calls.push(label);
        if (label === "Mesa 2") throw new Error("taken");
        return label.toUpperCase();
      },
      taken,
      undefined,
      (done) => progress.push(done),
    );
    expect(calls).toEqual(["Mesa 1", "Mesa 2", "Mesa 3"]);
    expect(result).toEqual({ created: ["MESA 1", "MESA 3"], taken: ["Mesa 2"], error: null });
    expect(progress).toEqual([1, 2, 3]);
  });

  it("stops at the first other error and reports what was created before it", async () => {
    const failure = new Error("red");
    const created: string[] = [];
    const result = await createInOrder(
      ["Mesa 1", "Mesa 2", "Mesa 3"],
      async (label) => {
        if (label === "Mesa 2") throw failure;
        return label;
      },
      taken,
      (item) => created.push(item),
    );
    expect(result).toEqual({ created: ["Mesa 1"], taken: [], error: failure });
    expect(created).toEqual(["Mesa 1"]);
  });
});

describe("namedTables", () => {
  it("maps labels to the name the shared rules use", () => {
    expect(namedTables([{ id: "t1", label: "Mesa 1" }])).toEqual([{ id: "t1", name: "Mesa 1" }]);
  });
});
