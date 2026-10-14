import type { FloorTableView } from "@app/types";
import { floorPlanProblem } from "@app/utils";
import { describe, expect, it } from "vitest";
import {
  defaultFloorPlan,
  draftFromView,
  dropAt,
  edgeCells,
  firstFreeCell,
  type FloorDraft,
  floorConflicts,
  isRefusal,
  itemByKey,
  moveArea,
  moveRect,
  placeDoor,
  placePickup,
  placeTable,
  removeFromPlan,
  removeTable,
  resizeArea,
  resizeGrid,
  resizeRect,
  ROTATE_REFUSAL_MESSAGES,
  rotateTable,
  sameDraft,
  saveInput,
  serviceWarnings,
  shortTableLabel,
  tableChairs,
  unplacedTables,
  withTables,
} from "./floor-editor";

const table = (id: string, active = true): FloorTableView => ({ id, label: `Mesa ${id}`, active, layout: null });
const tables = (count: number) => Array.from({ length: count }, (_, i) => table(String(i + 1)));
const everything = { pickupEnabled: true, deliveryEnabled: true };

/** A small valid draft: 8 × 6, kitchen 2 × 2 in the corner, no counter nor door, table "a" at 0,5. */
function draft(): FloorDraft {
  return {
    plan: { cols: 8, rows: 6, kitchen: { x: 6, y: 0, w: 2, h: 2 }, pickup: null, door: null },
    layouts: { a: { x: 0, y: 5, shape: "square", seats: 4, rotation: 0 }, b: null },
  };
}

const problemOf = (d: FloorDraft, list: readonly FloorTableView[]) => floorPlanProblem(d.plan, saveInput(d, list).tables);

describe("defaultFloorPlan", () => {
  it("draws a 14 × 9 plan with the kitchen top right and only the zones the restaurant uses", () => {
    const none = defaultFloorPlan({ pickupEnabled: false, deliveryEnabled: false }, []);
    expect(none.plan).toEqual({ cols: 14, rows: 9, kitchen: { x: 10, y: 0, w: 4, h: 3 }, pickup: null, door: null });
    const all = defaultFloorPlan(everything, []);
    expect(all.plan.pickup).toEqual({ x: 11, y: 7, w: 3, h: 2 });
    expect(all.plan.door).toEqual({ x: 7, y: 8 });
  });

  it("places the active tables square with 4 seats, one cell apart, and leaves inactive ones out", () => {
    const list = [table("1"), table("2", false), table("3")];
    const result = defaultFloorPlan(everything, list);
    expect(result.layouts).toEqual({
      "1": { x: 1, y: 1, shape: "square", seats: 4, rotation: 0 },
      "2": null,
      "3": { x: 3, y: 1, shape: "square", seats: 4, rotation: 0 },
    });
    expect(problemOf(result, list)).toBeNull();
  });

  it("is always valid and leaves the tables that do not fit unplaced", () => {
    for (const flags of [everything, { pickupEnabled: false, deliveryEnabled: false }]) {
      const list = tables(40);
      const result = defaultFloorPlan(flags, list);
      expect(problemOf(result, list)).toBeNull();
      const placed = Object.values(result.layouts).filter(Boolean).length;
      expect(placed).toBeGreaterThan(10);
      expect(placed).toBeLessThan(40);
      expect(unplacedTables(result, list)).toHaveLength(40 - placed);
    }
  });
});

describe("areas", () => {
  it("moves a rectangle inside the grid", () => {
    expect(moveRect({ x: 0, y: 0, w: 3, h: 2 }, 7, -2, 8, 6)).toEqual({ x: 5, y: 0, w: 3, h: 2 });
    expect(moveArea(draft(), "kitchen", 0, 4).plan.kitchen).toEqual({ x: 0, y: 4, w: 2, h: 2 });
    expect(moveArea(draft(), "pickup", 1, 1)).toEqual(draft());
  });

  it("resizes between the minimum and the grid, sliding back at the edge", () => {
    expect(resizeRect({ x: 6, y: 0, w: 2, h: 2 }, 3, 2, 8, 6)).toEqual({ x: 5, y: 0, w: 3, h: 2 });
    expect(resizeRect({ x: 0, y: 0, w: 2, h: 2 }, 1, 1, 8, 6)).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(resizeRect({ x: 0, y: 0, w: 2, h: 2 }, 20, 20, 8, 6)).toEqual({ x: 0, y: 0, w: 8, h: 6 });
    expect(resizeArea(draft(), "kitchen", 2, 3).plan.kitchen).toEqual({ x: 6, y: 0, w: 2, h: 3 });
  });

  it("adds, moves and removes the pickup counter", () => {
    const added = placePickup(draft(), 7, 5);
    expect(added.plan.pickup).toEqual({ x: 5, y: 4, w: 3, h: 2 });
    expect(placePickup(added, 0, 0).plan.pickup).toEqual({ x: 0, y: 0, w: 3, h: 2 });
    expect(removeFromPlan(added, "pickup").plan.pickup).toBeNull();
  });

  it("lets an area cover a table, and reports the shared cells", () => {
    const covered = moveArea(draft(), "kitchen", 0, 4);
    const conflicts = floorConflicts(covered);
    expect([...conflicts.cells]).toEqual(["0,5"]);
    expect([...conflicts.items].sort()).toEqual(["kitchen", "table:a"]);
    expect(problemOf(covered, [table("a"), table("b")])).toBe("overlap");
    expect(floorConflicts(draft()).cells.size).toBe(0);
  });
});

describe("door", () => {
  it("lists the edge cells", () => {
    const cells = edgeCells(6, 4);
    expect(cells).toHaveLength(2 * 6 + 2 * 2);
    expect(cells).toContainEqual({ x: 0, y: 2 });
    expect(cells).not.toContainEqual({ x: 1, y: 1 });
  });

  it("goes only on a free edge cell", () => {
    expect(placeDoor(draft(), { x: 3, y: 3 })).toBe("not_on_edge");
    expect(placeDoor(draft(), { x: 7, y: 1 })).toBe("taken");
    expect(placeDoor(draft(), { x: 0, y: 5 })).toBe("taken");
    expect(placeDoor(draft(), { x: 9, y: 0 })).toBe("out_of_bounds");
    const placed = placeDoor(draft(), { x: 3, y: 5 });
    expect(isRefusal(placed) ? placed : placed.plan.door).toEqual({ x: 3, y: 5 });
  });
});

describe("tables", () => {
  it("places and moves a table on a free cell", () => {
    const placed = placeTable(draft(), "b", { x: 2, y: 2, shape: "round", seats: 2, rotation: 0 });
    expect(isRefusal(placed)).toBe(false);
    const moved = placeTable(placed as FloorDraft, "a", { x: 4, y: 4, shape: "square", seats: 4, rotation: 0 });
    expect(isRefusal(moved) ? null : moved.layouts.a).toEqual({ x: 4, y: 4, shape: "square", seats: 4, rotation: 0 });
  });

  it("refuses taken cells and cells outside the grid, counting long tables as two cells", () => {
    expect(placeTable(draft(), "b", { x: 0, y: 5, shape: "square", seats: 4, rotation: 0 })).toBe("taken");
    expect(placeTable(draft(), "b", { x: 5, y: 0, shape: "square", seats: 8, rotation: 0 })).toBe("taken");
    expect(placeTable(draft(), "b", { x: 7, y: 3, shape: "square", seats: 6, rotation: 0 })).toBe("out_of_bounds");
    expect(placeTable(draft(), "b", { x: 6, y: 3, shape: "square", seats: 6, rotation: 0 })).not.toBe("out_of_bounds");
    // A table may move onto cells it already takes.
    expect(isRefusal(placeTable(draft(), "a", { x: 0, y: 5, shape: "round", seats: 6, rotation: 0 }))).toBe(false);
  });

  it("finds the first free cell for a table", () => {
    expect(firstFreeCell(draft(), "b", { shape: "square", seats: 4, rotation: 0 })).toEqual({ x: 0, y: 0 });
    expect(firstFreeCell(draft(), "b", { shape: "square", seats: 8, rotation: 0 })).toEqual({ x: 0, y: 0 });
    const full: FloorDraft = { plan: { ...draft().plan, cols: 6, rows: 4, kitchen: { x: 0, y: 0, w: 6, h: 4 } }, layouts: {} };
    expect(firstFreeCell(full, "b", { shape: "round", seats: 2, rotation: 0 })).toBeNull();
  });

  it("takes a table off the plan and lists the active unplaced ones", () => {
    const removed = removeTable(draft(), "a");
    expect(removed.layouts.a).toBeNull();
    expect(unplacedTables(removed, [table("a"), table("b", false)]).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("rotation", () => {
  it("turns a long table under itself and back", () => {
    const long: FloorDraft = { ...draft(), layouts: { a: { x: 0, y: 3, shape: "square", seats: 6, rotation: 0 } } };
    const turned = rotateTable(long, "a");
    expect(isRefusal(turned) ? null : turned.layouts.a).toEqual({ x: 0, y: 3, shape: "square", seats: 6, rotation: 90 });
    expect(isRefusal(turned) ? null : itemByKey(turned, "table:a")?.rect).toEqual({ x: 0, y: 3, w: 1, h: 2 });
    const back = isRefusal(turned) ? turned : rotateTable(turned, "a");
    expect(isRefusal(back) ? null : back.layouts.a?.rotation).toBe(0);
  });

  it("refuses a turn that falls outside the plan or onto something", () => {
    // Last row: the second cell would be row 6 of a 6-row plan.
    const bottom: FloorDraft = { ...draft(), layouts: { a: { x: 2, y: 5, shape: "round", seats: 8, rotation: 0 } } };
    expect(rotateTable(bottom, "a")).toBe("out_of_bounds");
    // Another table right below the first cell.
    const blocked: FloorDraft = {
      ...draft(),
      layouts: { a: { x: 2, y: 2, shape: "square", seats: 6, rotation: 0 }, b: { x: 2, y: 3, shape: "round", seats: 2, rotation: 0 } },
    };
    expect(rotateTable(blocked, "a")).toBe("taken");
    expect(ROTATE_REFUSAL_MESSAGES.taken).toBe("No cabe girada: hay algo al lado");
    expect(ROTATE_REFUSAL_MESSAGES.out_of_bounds).toMatch(/fuera del plano/);
  });

  it("turns small tables in their own cell, and leaves unplaced tables alone", () => {
    const turned = rotateTable(draft(), "a");
    expect(isRefusal(turned) ? null : turned.layouts.a).toEqual({ x: 0, y: 5, shape: "square", seats: 4, rotation: 90 });
    expect(rotateTable(draft(), "b")).toEqual(draft());
    expect(rotateTable(draft(), "missing")).toEqual(draft());
  });

  it("keeps the orientation when the table changes seats, moves or is dragged", () => {
    const vertical: FloorDraft = { ...draft(), layouts: { a: { x: 0, y: 3, shape: "square", seats: 4, rotation: 90 } } };
    // Growing to 6 seats takes the cell below (0, 4), not the one beside it.
    const grown = placeTable(vertical, "a", { x: 0, y: 3, shape: "square", seats: 6, rotation: 90 });
    expect(isRefusal(grown) ? null : itemByKey(grown, "table:a")?.rect).toEqual({ x: 0, y: 3, w: 1, h: 2 });
    expect(placeTable(vertical, "a", { x: 0, y: 5, shape: "square", seats: 6, rotation: 90 })).toBe("out_of_bounds");
    // A dragged vertical table is kept inside the grid by its height.
    const long: FloorDraft = { ...draft(), layouts: { a: { x: 0, y: 3, shape: "round", seats: 8, rotation: 90 } } };
    const moved = dropAt(long, { kind: "table", id: "a" }, { x: 9, y: 9 });
    expect(moved.rect).toEqual({ x: 7, y: 4, w: 1, h: 2 });
    expect(isRefusal(moved.result) ? null : moved.result.layouts.a?.rotation).toBe(90);
    // firstFreeCell honors the orientation it is given (the kitchen fills rows 0–1).
    const narrow: FloorDraft = { plan: { ...draft().plan, cols: 6, rows: 4, kitchen: { x: 0, y: 0, w: 6, h: 2 } }, layouts: {} };
    expect(firstFreeCell(narrow, "b", { shape: "square", seats: 6, rotation: 90 })).toEqual({ x: 0, y: 2 });
  });

  it("draws the chairs along the long sides", () => {
    expect(tableChairs({ shape: "square", seats: 4, rotation: 0 })).toEqual({ sides: "top-bottom", perSide: 2 });
    expect(tableChairs({ shape: "square", seats: 4, rotation: 90 })).toEqual({ sides: "left-right", perSide: 2 });
    expect(tableChairs({ shape: "round", seats: 2, rotation: 90 })).toEqual({ sides: "top-bottom", perSide: 1 });
    expect(tableChairs({ shape: "round", seats: 8, rotation: 90 })).toEqual({ sides: "left-right", perSide: 4 });
    expect(tableChairs({ shape: "square", seats: 6, rotation: 0 })).toEqual({ sides: "top-bottom", perSide: 3 });
  });

  it("saves the rotation and validates the vertical footprint like the api", () => {
    const vertical: FloorDraft = { ...draft(), layouts: { a: { x: 7, y: 2, shape: "square", seats: 6, rotation: 90 }, b: null } };
    expect(saveInput(vertical, [table("a")]).tables).toEqual([{ tableId: "a", layout: { x: 7, y: 2, shape: "square", seats: 6, rotation: 90 } }]);
    expect(problemOf(vertical, [table("a"), table("b")])).toBeNull();
    const intoKitchen: FloorDraft = { ...draft(), layouts: { a: { x: 6, y: 1, shape: "square", seats: 6, rotation: 90 } } };
    expect(problemOf(intoKitchen, [table("a")])).toBe("overlap");
  });
});

describe("resizeGrid", () => {
  it("grows and shrinks while everything fits, keeping the door on its edge", () => {
    const withDoor = { ...draft(), plan: { ...draft().plan, door: { x: 3, y: 5 } } };
    const grown = resizeGrid(withDoor, 10, 8);
    expect("blockedBy" in grown ? null : grown.plan).toMatchObject({ cols: 10, rows: 8, door: { x: 3, y: 7 } });
    const moved = { ...draft(), plan: { ...draft().plan, kitchen: { x: 0, y: 0, w: 2, h: 2 } } };
    const shrunk = resizeGrid(moved, 6, 6);
    expect("blockedBy" in shrunk ? null : shrunk.plan.cols).toBe(6);
  });

  it("is refused when something would fall outside, and stays within the limits", () => {
    expect(resizeGrid(draft(), 7, 6)).toEqual({ blockedBy: { kind: "kitchen" } });
    expect(resizeGrid(draft(), 8, 5)).toEqual({ blockedBy: { kind: "table", id: "a" } });
    const huge = resizeGrid(draft(), 99, 99);
    expect("blockedBy" in huge ? null : [huge.plan.cols, huge.plan.rows]).toEqual([24, 16]);
  });
});

describe("saving", () => {
  it("lists every table, the unplaced ones with a null layout", () => {
    expect(saveInput(draft(), [table("a"), table("b"), table("c")])).toEqual({
      plan: draft().plan,
      tables: [
        { tableId: "a", layout: { x: 0, y: 5, shape: "square", seats: 4, rotation: 0 } },
        { tableId: "b", layout: null },
        { tableId: "c", layout: null },
      ],
    });
    expect(saveInput(null, [table("a")])).toEqual({ plan: null, tables: [{ tableId: "a", layout: null }] });
  });

  it("compares drafts and reads a saved view", () => {
    const list = [table("a"), table("b")];
    expect(sameDraft(draft(), draft(), list)).toBe(true);
    expect(sameDraft(draft(), removeTable(draft(), "a"), list)).toBe(false);
    expect(sameDraft(null, null, list)).toBe(true);
    expect(draftFromView({ plan: null, tables: list })).toBeNull();
    const view = { plan: draft().plan, tables: [{ ...table("a"), layout: draft().layouts.a ?? null }, table("b")] };
    expect(draftFromView(view)).toEqual(draft());
  });
});

describe("withTables", () => {
  it("drops deleted tables and adds new ones unplaced, keeping the plan", () => {
    const merged = withTables(draft(), [table("a"), table("c")]);
    expect(merged).toEqual({ plan: draft().plan, layouts: { a: draft().layouts.a, c: null } });
  });
});

describe("serviceWarnings", () => {
  it("warns when the plan and the enabled services disagree", () => {
    expect(serviceWarnings(everything, { pickup: { x: 0, y: 0, w: 2, h: 2 }, door: { x: 0, y: 3 } })).toEqual([]);
    expect(serviceWarnings({ pickupEnabled: false, deliveryEnabled: false }, { pickup: null, door: null })).toEqual([]);
    expect(serviceWarnings(everything, { pickup: null, door: null })).toHaveLength(2);
    const extra = serviceWarnings({ pickupEnabled: false, deliveryEnabled: false }, { pickup: { x: 0, y: 0, w: 2, h: 2 }, door: { x: 0, y: 3 } });
    expect(extra.join(" ")).toMatch(/retiro.*desactivado.*delivery está desactivado/);
  });
});

describe("shortTableLabel", () => {
  it("shortens the usual table names for the grid", () => {
    expect(shortTableLabel("Mesa 12")).toBe("12");
    expect(shortTableLabel("mesa A")).toBe("A");
    expect(shortTableLabel("Terraza 3")).toBe("T3");
    expect(shortTableLabel("Barra")).toBe("Barra");
  });
});

describe("dropAt", () => {
  it("moves or adds areas inside the grid, even over a table", () => {
    const kitchen = dropAt(draft(), { kind: "kitchen" }, { x: -1, y: 5 });
    expect(kitchen.rect).toEqual({ x: 0, y: 4, w: 2, h: 2 });
    expect(isRefusal(kitchen.result) ? null : floorConflicts(kitchen.result).cells.size).toBe(1);
    expect(dropAt(draft(), { kind: "pickup" }, { x: 2, y: 1 }).rect).toEqual({ x: 2, y: 1, w: 3, h: 2 });
  });

  it("places the door only on a free edge, and tables only on free cells", () => {
    expect(dropAt(draft(), { kind: "door" }, { x: 3, y: 2 }).result).toBe("not_on_edge");
    const added = dropAt(draft(), { kind: "new-table", id: "b" }, { x: 3, y: 3 });
    expect(isRefusal(added.result) ? null : added.result.layouts.b).toEqual({ x: 3, y: 3, shape: "square", seats: 4, rotation: 0 });
    expect(dropAt(draft(), { kind: "new-table", id: "b" }, { x: 0, y: 5 }).result).toBe("taken");
  });

  it("keeps a dragged table inside the grid", () => {
    const long: FloorDraft = { ...draft(), layouts: { a: { x: 0, y: 5, shape: "round", seats: 8, rotation: 0 } } };
    const moved = dropAt(long, { kind: "table", id: "a" }, { x: 9, y: 9 });
    expect(moved.rect).toEqual({ x: 6, y: 5, w: 2, h: 1 });
    expect(isRefusal(moved.result)).toBe(false);
  });

  it("finds an item by its key", () => {
    expect(itemByKey(draft(), "table:a")?.rect).toEqual({ x: 0, y: 5, w: 1, h: 1 });
    expect(itemByKey(draft(), "pickup")).toBeNull();
  });
});
