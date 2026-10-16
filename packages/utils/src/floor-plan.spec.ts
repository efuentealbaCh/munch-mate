import type { FloorLevel, FloorPlanInput, TableLayout } from "@app/types";
import {
  defaultFloors,
  FLOOR_PLAN_MESSAGES,
  floorPlanProblem,
  isEdgeCell,
  materialAt,
  paintTerrain,
  rectInGrid,
  rectsOverlap,
  resizeTerrain,
  tableFootprint,
} from "./floor-plan";

/** 14 × 9 with the kitchen in the top-left corner, the counter on the right and the door at the bottom. */
const plan = (overrides: Partial<FloorPlanInput> = {}): FloorPlanInput => ({
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
    expect(floorPlanProblem(plan(), [table("t1", { x: 4, y: 4, seats: 6 }), table("t2", { x: 5, y: 4 })])).toBe(
      "overlap",
    );
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

describe("terrain", () => {
  it("reads unpainted floors as plain floor", () => {
    expect(materialAt(null, 14, { x: 3, y: 3 })).toBe("floor");
  });

  it("paints cells and collapses an unpainted floor back to null", () => {
    const painted = paintTerrain(
      null,
      6,
      4,
      [
        { x: 0, y: 0 },
        { x: 5, y: 3 },
        { x: 9, y: 9 },
      ],
      "wall",
    );
    expect(painted).toHaveLength(24);
    expect(materialAt(painted, 6, { x: 0, y: 0 })).toBe("wall");
    expect(materialAt(painted, 6, { x: 5, y: 3 })).toBe("wall");
    expect(materialAt(painted, 6, { x: 1, y: 0 })).toBe("floor");
    expect(
      paintTerrain(
        painted,
        6,
        4,
        [
          { x: 0, y: 0 },
          { x: 5, y: 3 },
        ],
        "floor",
      ),
    ).toBeNull();
  });

  it("keeps painted cells in place when the grid is resized", () => {
    const painted = paintTerrain(
      null,
      6,
      4,
      [
        { x: 1, y: 1 },
        { x: 5, y: 3 },
      ],
      "grass",
    );
    const grown = resizeTerrain(painted, 6, 8, 5);
    expect(grown).toHaveLength(40);
    expect(materialAt(grown, 8, { x: 1, y: 1 })).toBe("grass");
    expect(materialAt(grown, 8, { x: 5, y: 3 })).toBe("grass");
    expect(materialAt(grown, 8, { x: 7, y: 4 })).toBe("floor");
    // Shrinking drops the cells beyond the new size.
    expect(materialAt(resizeTerrain(painted, 6, 6, 4), 6, { x: 1, y: 1 })).toBe("grass");
    expect(resizeTerrain(paintTerrain(null, 6, 4, [{ x: 5, y: 3 }], "grass"), 6, 5, 3)).toBeNull();
  });
});

describe("floorPlanProblem with floors, terrain and decorations", () => {
  const level = (overrides: Partial<FloorLevel> = {}): FloorLevel => ({
    name: "Terraza",
    terrain: null,
    decor: [],
    ...overrides,
  });
  const paint = (cells: { x: number; y: number }[], material: "wall" | "void" | "wood") =>
    paintTerrain(null, 14, 9, cells, material);

  it("reads a plan without floors as one plain floor", () => {
    expect(defaultFloors()).toEqual([{ name: "Primer piso", terrain: null, decor: [] }]);
    expect(floorPlanProblem(plan({ floors: defaultFloors() }), [table("t1", {})])).toBeNull();
  });

  it("places tables on other floors, where the kitchen and the door take no cell", () => {
    const floors = [level({ name: "Primer piso" }), level()];
    expect(
      floorPlanProblem(plan({ floors }), [table("t1", { x: 0, y: 0, floor: 1 }), table("t2", { x: 0, y: 4 })]),
    ).toBeNull();
    expect(floorPlanProblem(plan({ floors }), [table("t1", { x: 0, y: 0 })])).toBe("overlap");
    expect(floorPlanProblem(plan({ floors }), [table("t1", { floor: 2 })])).toBe("unknown_floor");
    expect(floorPlanProblem(plan(), [table("t1", { floor: 1 })])).toBe("unknown_floor");
  });

  it("rejects bad floor lists", () => {
    expect(floorPlanProblem(plan({ floors: [] }), [])).toBe("invalid_floors");
    expect(floorPlanProblem(plan({ floors: [level(), level(), level(), level(), level()] }), [])).toBe(
      "invalid_floors",
    );
    expect(floorPlanProblem(plan({ floors: [level({ name: "  " })] }), [])).toBe("invalid_floors");
    expect(floorPlanProblem(plan({ floors: [level({ name: "x".repeat(31) })] }), [])).toBe("invalid_floors");
  });

  it("rejects terrain of another size or with unknown codes", () => {
    expect(floorPlanProblem(plan({ floors: [level({ terrain: ".".repeat(10) })] }), [])).toBe("invalid_terrain");
    expect(floorPlanProblem(plan({ floors: [level({ terrain: "x".repeat(126) })] }), [])).toBe("invalid_terrain");
    expect(floorPlanProblem(plan({ floors: [level({ terrain: paint([{ x: 6, y: 6 }], "wood") })] }), [])).toBeNull();
  });

  it("keeps tables, areas and decorations off walls and cells outside the building", () => {
    const walled = (cells: { x: number; y: number }[], material: "wall" | "void" = "wall") =>
      plan({ floors: [level({ terrain: paint(cells, material) })] });
    expect(floorPlanProblem(walled([{ x: 5, y: 4 }]), [table("t1", { x: 5, y: 4 })])).toBe("blocked_cell");
    expect(floorPlanProblem(walled([{ x: 6, y: 4 }]), [table("t1", { x: 5, y: 4, seats: 8 })])).toBe("blocked_cell");
    expect(floorPlanProblem(walled([{ x: 1, y: 1 }], "void"), [])).toBe("blocked_cell");
    // The door may open a wall, never lead outside the building.
    expect(floorPlanProblem(walled([{ x: 13, y: 8 }]), [])).toBeNull();
    expect(floorPlanProblem(walled([{ x: 13, y: 8 }], "void"), [])).toBe("blocked_cell");
    const decorated = plan({
      floors: [level({ terrain: paint([{ x: 6, y: 6 }], "wall"), decor: [{ kind: "plant", x: 6, y: 6 }] })],
    });
    expect(floorPlanProblem(decorated, [])).toBe("blocked_cell");
  });

  it("checks decorations: kinds, count, grid and free cells", () => {
    const decorated = (decor: FloorLevel["decor"]) => plan({ floors: [level({ decor })] });
    expect(
      floorPlanProblem(
        decorated([
          { kind: "tree", x: 6, y: 6 },
          { kind: "planter", x: 7, y: 6 },
        ]),
        [],
      ),
    ).toBeNull();
    expect(floorPlanProblem(decorated([{ kind: "statue" as "tree", x: 6, y: 6 }]), [])).toBe("invalid_decor");
    expect(
      floorPlanProblem(
        decorated(Array.from({ length: 151 }, (_, i) => ({ kind: "plant" as const, x: i % 14, y: 8 }))),
        [],
      ),
    ).toBe("invalid_decor");
    expect(floorPlanProblem(decorated([{ kind: "plant", x: 14, y: 0 }]), [])).toBe("out_of_bounds");
    expect(floorPlanProblem(decorated([{ kind: "plant", x: 1, y: 1 }]), [])).toBe("overlap");
    expect(floorPlanProblem(decorated([{ kind: "plant", x: 5, y: 4 }]), [table("t1", {})])).toBe("overlap");
    expect(
      floorPlanProblem(
        decorated([
          { kind: "plant", x: 6, y: 6 },
          { kind: "lamp", x: 6, y: 6 },
        ]),
        [],
      ),
    ).toBe("overlap");
  });
});
