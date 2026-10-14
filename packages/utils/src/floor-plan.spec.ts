import type { FloorPlan, TableLayout } from "@app/types";
import { FLOOR_PLAN_MESSAGES, floorPlanProblem, isEdgeCell, rectInGrid, rectsOverlap, tableFootprint } from "./floor-plan";

/** 14 × 9 with the kitchen in the top-left corner, the counter on the right and the door at the bottom. */
const plan = (overrides: Partial<FloorPlan> = {}): FloorPlan => ({
  cols: 14,
  rows: 9,
  kitchen: { x: 0, y: 0, w: 4, h: 3 },
  pickup: { x: 11, y: 0, w: 3, h: 2 },
  door: { x: 13, y: 8 },
  ...overrides,
});

const table = (tableId: string, layout: Partial<TableLayout> | null) => ({
  tableId,
  layout: layout && { x: 5, y: 4, shape: "round" as const, seats: 4 as const, ...layout },
});

describe("tableFootprint", () => {
  it("gives small tables one cell and long tables two cells side by side", () => {
    expect(tableFootprint({ x: 3, y: 2, seats: 2 })).toEqual({ x: 3, y: 2, w: 1, h: 1 });
    expect(tableFootprint({ x: 3, y: 2, seats: 4 })).toEqual({ x: 3, y: 2, w: 1, h: 1 });
    expect(tableFootprint({ x: 3, y: 2, seats: 6 })).toEqual({ x: 3, y: 2, w: 2, h: 1 });
    expect(tableFootprint({ x: 3, y: 2, seats: 8 })).toEqual({ x: 3, y: 2, w: 2, h: 1 });
  });

  it("turns long tables one cell under the other when vertical, and leaves small tables in one cell", () => {
    expect(tableFootprint({ x: 3, y: 2, seats: 6, rotation: 0 })).toEqual({ x: 3, y: 2, w: 2, h: 1 });
    expect(tableFootprint({ x: 3, y: 2, seats: 6, rotation: 90 })).toEqual({ x: 3, y: 2, w: 1, h: 2 });
    expect(tableFootprint({ x: 3, y: 2, seats: 8, rotation: 90 })).toEqual({ x: 3, y: 2, w: 1, h: 2 });
    expect(tableFootprint({ x: 3, y: 2, seats: 4, rotation: 90 })).toEqual({ x: 3, y: 2, w: 1, h: 1 });
    expect(tableFootprint({ x: 3, y: 2, seats: 2, rotation: 90 })).toEqual({ x: 3, y: 2, w: 1, h: 1 });
  });
});

describe("geometry helpers", () => {
  it("detects shared cells but not touching edges", () => {
    const a = { x: 0, y: 0, w: 2, h: 2 };
    expect(rectsOverlap(a, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(rectsOverlap(a, { x: 2, y: 0, w: 1, h: 1 })).toBe(false);
    expect(rectsOverlap(a, { x: 0, y: 2, w: 1, h: 1 })).toBe(false);
  });

  it("checks rectangles against the grid", () => {
    expect(rectInGrid({ x: 12, y: 7, w: 2, h: 2 }, 14, 9)).toBe(true);
    expect(rectInGrid({ x: 13, y: 7, w: 2, h: 2 }, 14, 9)).toBe(false);
    expect(rectInGrid({ x: -1, y: 0, w: 2, h: 2 }, 14, 9)).toBe(false);
  });

  it("knows the edge cells", () => {
    expect(isEdgeCell({ x: 0, y: 4 }, 14, 9)).toBe(true);
    expect(isEdgeCell({ x: 5, y: 0 }, 14, 9)).toBe(true);
    expect(isEdgeCell({ x: 13, y: 4 }, 14, 9)).toBe(true);
    expect(isEdgeCell({ x: 5, y: 8 }, 14, 9)).toBe(true);
    expect(isEdgeCell({ x: 5, y: 4 }, 14, 9)).toBe(false);
  });
});

describe("floorPlanProblem", () => {
  it("accepts a valid plan with tables of every size", () => {
    expect(
      floorPlanProblem(plan(), [
        table("t1", { x: 5, y: 4 }),
        table("t2", { x: 6, y: 4, seats: 2, shape: "square" }),
        table("t3", { x: 7, y: 4, seats: 8 }),
        table("t4", null),
      ]),
    ).toBeNull();
  });

  it("accepts a plan with only the kitchen", () => {
    expect(floorPlanProblem(plan({ pickup: null, door: null }), [])).toBeNull();
  });

  it("accepts the smallest and largest grids", () => {
    expect(floorPlanProblem(plan({ cols: 6, rows: 4, pickup: null, door: null }), [])).toBeNull();
    expect(floorPlanProblem(plan({ cols: 24, rows: 16, door: { x: 0, y: 15 } }), [])).toBeNull();
  });

  it("rejects grids outside the limits or not whole", () => {
    expect(floorPlanProblem(plan({ cols: 5 }), [])).toBe("size");
    expect(floorPlanProblem(plan({ cols: 25 }), [])).toBe("size");
    expect(floorPlanProblem(plan({ rows: 3 }), [])).toBe("size");
    expect(floorPlanProblem(plan({ rows: 17 }), [])).toBe("size");
    expect(floorPlanProblem(plan({ cols: 10.5 }), [])).toBe("size");
    expect(floorPlanProblem(plan({ rows: Number.NaN }), [])).toBe("size");
  });

  it("requires a kitchen", () => {
    expect(floorPlanProblem(plan({ kitchen: null as unknown as FloorPlan["kitchen"] }), [])).toBe("kitchen_required");
  });

  it("rejects areas smaller than 2 × 2, not whole or outside the grid", () => {
    expect(floorPlanProblem(plan({ kitchen: { x: 0, y: 0, w: 1, h: 3 } }), [])).toBe("area_too_small");
    expect(floorPlanProblem(plan({ pickup: { x: 11, y: 0, w: 3, h: 1 } }), [])).toBe("area_too_small");
    expect(floorPlanProblem(plan({ kitchen: { x: 0.5, y: 0, w: 2, h: 2 } }), [])).toBe("not_integer");
    expect(floorPlanProblem(plan({ kitchen: { x: 12, y: 0, w: 3, h: 2 }, pickup: null }), [])).toBe("out_of_bounds");
    expect(floorPlanProblem(plan({ pickup: { x: 11, y: 8, w: 3, h: 2 } }), [])).toBe("out_of_bounds");
    expect(floorPlanProblem(plan({ kitchen: { x: -1, y: 0, w: 3, h: 2 } }), [])).toBe("out_of_bounds");
  });

  it("rejects the kitchen and the counter on top of each other, but lets them touch", () => {
    expect(floorPlanProblem(plan({ pickup: { x: 3, y: 2, w: 2, h: 2 } }), [])).toBe("overlap");
    expect(floorPlanProblem(plan({ pickup: { x: 4, y: 0, w: 2, h: 2 } }), [])).toBeNull();
  });

  it("puts the door on an edge, inside the grid and outside the areas", () => {
    expect(floorPlanProblem(plan({ door: { x: 0, y: 5 } }), [])).toBeNull();
    expect(floorPlanProblem(plan({ door: { x: 6, y: 0 } }), [])).toBeNull();
    expect(floorPlanProblem(plan({ door: { x: 6, y: 4 } }), [])).toBe("door_not_on_edge");
    expect(floorPlanProblem(plan({ door: { x: 14, y: 4 } }), [])).toBe("out_of_bounds");
    expect(floorPlanProblem(plan({ door: { x: 1, y: 0 } }), [])).toBe("door_inside_area");
    expect(floorPlanProblem(plan({ door: { x: 13, y: 1 } }), [])).toBe("door_inside_area");
    expect(floorPlanProblem(plan({ door: { x: 0.5, y: 0 } }), [])).toBe("not_integer");
  });

  it("keeps tables inside the grid, counting the second cell of long tables", () => {
    expect(floorPlanProblem(plan(), [table("t1", { x: 13, y: 5 })])).toBeNull();
    expect(floorPlanProblem(plan(), [table("t1", { x: 13, y: 5, seats: 6 })])).toBe("out_of_bounds");
    expect(floorPlanProblem(plan(), [table("t1", { x: 5, y: 9 })])).toBe("out_of_bounds");
    expect(floorPlanProblem(plan(), [table("t1", { x: -1, y: 5 })])).toBe("out_of_bounds");
    expect(floorPlanProblem(plan(), [table("t1", { x: 5.5, y: 5 })])).toBe("not_integer");
  });

  it("rejects tables on each other, on an area or on the door", () => {
    expect(floorPlanProblem(plan(), [table("t1", { x: 5, y: 4 }), table("t2", { x: 5, y: 4 })])).toBe("overlap");
    // The long table starting at 4 takes cell 5 too.
    expect(floorPlanProblem(plan(), [table("t1", { x: 4, y: 4, seats: 6 }), table("t2", { x: 5, y: 4 })])).toBe("overlap");
    expect(floorPlanProblem(plan(), [table("t1", { x: 4, y: 4, seats: 6 }), table("t2", { x: 6, y: 4 })])).toBeNull();
    expect(floorPlanProblem(plan(), [table("t1", { x: 3, y: 2 })])).toBe("overlap");
    expect(floorPlanProblem(plan(), [table("t1", { x: 10, y: 1, seats: 8 })])).toBe("overlap");
    expect(floorPlanProblem(plan(), [table("t1", { x: 13, y: 8 })])).toBe("overlap");
    expect(floorPlanProblem(plan({ door: null }), [table("t1", { x: 13, y: 8 })])).toBeNull();
  });

  it("places vertical long tables by their two cells one under the other", () => {
    // Fits where a horizontal one would not (x 13 is the last column) …
    expect(floorPlanProblem(plan(), [table("t1", { x: 13, y: 4, seats: 6, rotation: 90 })])).toBeNull();
    // … and reaches the row below: the bottom edge counts.
    expect(floorPlanProblem(plan(), [table("t1", { x: 5, y: 8, seats: 8, rotation: 90 })])).toBe("out_of_bounds");
    expect(floorPlanProblem(plan(), [table("t1", { x: 5, y: 7, seats: 8, rotation: 90 })])).toBeNull();
    // Its second cell (5, 5) is taken by the other table; side by side they fit.
    expect(
      floorPlanProblem(plan(), [table("t1", { x: 5, y: 4, seats: 6, rotation: 90 }), table("t2", { x: 5, y: 5 })]),
    ).toBe("overlap");
    expect(
      floorPlanProblem(plan(), [table("t1", { x: 5, y: 4, seats: 6, rotation: 90 }), table("t2", { x: 6, y: 5 })]),
    ).toBeNull();
    // Its second cell would block the door (13, 8).
    expect(floorPlanProblem(plan(), [table("t1", { x: 13, y: 7, seats: 6, rotation: 90 })])).toBe("overlap");
    // A small table turned keeps its single cell.
    expect(floorPlanProblem(plan(), [table("t1", { x: 5, y: 8, shape: "square", rotation: 90 })])).toBeNull();
  });

  it("rejects unknown shapes, seat counts and rotations", () => {
    expect(floorPlanProblem(plan(), [table("t1", { shape: "oval" as TableLayout["shape"] })])).toBe("invalid_table");
    expect(floorPlanProblem(plan(), [table("t1", { seats: 3 as TableLayout["seats"] })])).toBe("invalid_table");
    expect(floorPlanProblem(plan(), [table("t1", { rotation: 45 as TableLayout["rotation"] })])).toBe("invalid_table");
    expect(floorPlanProblem(plan(), [table("t1", { rotation: 180 as TableLayout["rotation"] })])).toBe("invalid_table");
    expect(floorPlanProblem(plan(), [table("t1", { rotation: 0 })])).toBeNull();
  });

  it("rejects the same table twice, even when one copy is off the plan", () => {
    expect(floorPlanProblem(plan(), [table("t1", { x: 5, y: 4 }), table("t1", null)])).toBe("duplicate_table");
  });

  it("without a plan, accepts no table placed", () => {
    expect(floorPlanProblem(null, [])).toBeNull();
    expect(floorPlanProblem(null, [table("t1", null)])).toBeNull();
    expect(floorPlanProblem(null, [table("t1", { x: 1, y: 1 })])).toBe("table_without_plan");
  });

  it("has a message for every problem", () => {
    for (const message of Object.values(FLOOR_PLAN_MESSAGES)) expect(message.length).toBeGreaterThan(10);
  });
});
