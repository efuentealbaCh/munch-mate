import {
  DECOR_KINDS,
  type FloorCell,
  type FloorLevel,
  type FloorMaterial,
  type FloorPlanInput,
  type FloorRect,
  FLOOR_LIMITS,
  FLOOR_MATERIALS,
  TABLE_ROTATIONS,
  TABLE_SEATS,
  TABLE_SHAPES,
  type TableLayout,
  type TableLayoutInput,
} from "@app/types";

/**
 * Why a floor plan cannot be saved (first problem found), shared by the api (400 INVALID_FLOOR_PLAN with
 * `meta.problem`) and the web editor.
 * - size: cols/rows are not whole numbers within FLOOR_LIMITS.
 * - kitchen_required: a plan without a kitchen.
 * - not_integer: a coordinate or size that is not a whole number of cells.
 * - area_too_small: the kitchen or the pickup counter is narrower or shallower than FLOOR_LIMITS.areaMin.
 * - out_of_bounds: an area, the door or a table falls outside the grid.
 * - overlap: two of kitchen, pickup counter and tables share a cell, or a table blocks the door.
 * - door_not_on_edge: the door is not on the first/last column or row.
 * - door_inside_area: the door is inside the kitchen or the pickup counter.
 * - invalid_table: a table layout with an unknown shape, number of seats or rotation.
 * - duplicate_table: the same table listed twice.
 * - table_without_plan: tables placed while there is no plan.
 * - invalid_floors: no floor, more than FLOOR_LIMITS.floorsMax, or a floor without a name or with a longer one.
 * - invalid_terrain: a floor's terrain is not `cols × rows` FLOOR_MATERIALS codes.
 * - blocked_cell: a table, an area or a decoration on a wall or outside the building (void), or the door outside.
 * - invalid_decor: an unknown decoration or more than FLOOR_LIMITS.decorMax on a floor.
 * - unknown_floor: a table on a floor the plan does not have.
 */
export type FloorPlanProblem =
  | "size"
  | "kitchen_required"
  | "not_integer"
  | "area_too_small"
  | "out_of_bounds"
  | "overlap"
  | "door_not_on_edge"
  | "door_inside_area"
  | "invalid_table"
  | "duplicate_table"
  | "table_without_plan"
  | "invalid_floors"
  | "invalid_terrain"
  | "blocked_cell"
  | "invalid_decor"
  | "unknown_floor";

/** Spanish (Chile) messages for each problem, shown by the api and the editor. */
export const FLOOR_PLAN_MESSAGES: Record<FloorPlanProblem, string> = {
  size: `El plano debe tener entre ${FLOOR_LIMITS.colsMin} y ${FLOOR_LIMITS.colsMax} columnas y entre ${FLOOR_LIMITS.rowsMin} y ${FLOOR_LIMITS.rowsMax} filas`,
  kitchen_required: "Ubica la cocina en el plano",
  not_integer: "Las posiciones y tamaños del plano deben ser celdas enteras",
  area_too_small: `La cocina y el mesón de retiro deben medir al menos ${FLOOR_LIMITS.areaMin}×${FLOOR_LIMITS.areaMin} celdas`,
  out_of_bounds: "Hay elementos fuera del plano; agrándalo o muévelos",
  overlap: "Hay elementos superpuestos en el plano (mesas, decoración, cocina, mesón de retiro o puerta)",
  door_not_on_edge: "La puerta de delivery debe estar en el borde del plano",
  door_inside_area: "La puerta de delivery no puede quedar dentro de la cocina ni del mesón de retiro",
  invalid_table: "Las mesas deben ser redondas o cuadradas, de 2, 4, 6 u 8 puestos, horizontales o verticales",
  duplicate_table: "Una mesa aparece dos veces en el plano",
  table_without_plan: "Dibuja el plano antes de ubicar las mesas",
  invalid_floors: `El plano debe tener entre 1 y ${FLOOR_LIMITS.floorsMax} pisos, cada uno con un nombre de hasta ${FLOOR_LIMITS.floorNameMax} caracteres`,
  invalid_terrain: "El terreno pintado de un piso no calza con el tamaño del plano; recarga la página",
  blocked_cell: "Hay mesas, áreas o decoración sobre un muro o fuera del local (y la puerta debe quedar dentro)",
  invalid_decor: `Cada piso admite hasta ${FLOOR_LIMITS.decorMax} decoraciones de los tipos disponibles`,
  unknown_floor: "Una mesa está en un piso que ya no existe",
};

/** Name of the floor of plans saved before floors existed, and of a new plan's first floor. */
export const FIRST_FLOOR_NAME = "Primer piso";

/** The floors of a plan saved before floors existed (or sent without them): one plain floor. */
export function defaultFloors(): FloorLevel[] {
  return [{ name: FIRST_FLOOR_NAME, terrain: null, decor: [] }];
}

const MATERIAL_BY_CODE = new Map<string, FloorMaterial>(
  Object.entries(FLOOR_MATERIALS).map(([material, code]) => [code, material as FloorMaterial]),
);

/** Whether a material keeps tables, areas and decorations out (walls, and cells outside the building). */
export function isBlockedMaterial(material: FloorMaterial): boolean {
  return material === "wall" || material === "void";
}

/**
 * The material of one cell of a floor.
 * @param terrain `FloorLevel.terrain` (null = all plain floor).
 * @returns "floor" for null terrain, cells outside the string or unknown codes.
 */
export function materialAt(terrain: string | null, cols: number, cell: FloorCell): FloorMaterial {
  if (!terrain) return "floor";
  return MATERIAL_BY_CODE.get(terrain.charAt(cell.y * cols + cell.x)) ?? "floor";
}

/** Joins cell codes into a terrain; a floor without paint is stored as null. */
function joinTerrain(codes: readonly string[]): string | null {
  return codes.every((code) => code === FLOOR_MATERIALS.floor) ? null : codes.join("");
}

/**
 * Paints cells of a floor with a material (cells outside the grid are ignored).
 * @returns The new terrain (null when no cell is painted any more).
 */
export function paintTerrain(
  terrain: string | null,
  cols: number,
  rows: number,
  cells: readonly FloorCell[],
  material: FloorMaterial,
): string | null {
  const codes = Array.from(
    { length: cols * rows },
    (_, i): string => FLOOR_MATERIALS[materialAt(terrain, cols, { x: i % cols, y: Math.floor(i / cols) })],
  );
  for (const cell of cells) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= cols || cell.y >= rows) continue;
    codes[cell.y * cols + cell.x] = FLOOR_MATERIALS[material];
  }
  return joinTerrain(codes);
}

/**
 * A floor's terrain for a grid of another size: cells keep their position from the top-left corner, new cells
 * are plain floor and cells beyond the new size are dropped.
 * @param cols Columns of the grid the terrain was painted on.
 */
export function resizeTerrain(terrain: string | null, cols: number, newCols: number, newRows: number): string | null {
  if (!terrain) return null;
  const rows = Math.floor(terrain.length / cols);
  const codes: string[] = [];
  for (let y = 0; y < newRows; y++) {
    for (let x = 0; x < newCols; x++) {
      codes.push(x < cols && y < rows ? FLOOR_MATERIALS[materialAt(terrain, cols, { x, y })] : FLOOR_MATERIALS.floor);
    }
  }
  return joinTerrain(codes);
}

/** Every cell of a rectangle. */
export function rectCells(rect: FloorRect): FloorCell[] {
  const cells: FloorCell[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) cells.push({ x, y });
  return cells;
}

/**
 * The cells a table takes on the plan, starting at `x, y`: tables of 2–4 seats take their own cell (their
 * rotation only turns the chairs); tables of 6–8 seats are long and take two cells, side by side when
 * horizontal (`rotation` 0 or missing: 2 × 1) or one under the other when vertical (90: 1 × 2).
 */
export function tableFootprint(layout: Pick<TableLayoutInput, "x" | "y" | "seats" | "rotation">): FloorRect {
  if (layout.seats < 6) return { x: layout.x, y: layout.y, w: 1, h: 1 };
  return layout.rotation === 90 ? { x: layout.x, y: layout.y, w: 1, h: 2 } : { x: layout.x, y: layout.y, w: 2, h: 1 };
}

/** Whether two rectangles share at least one cell (touching edges do not overlap). */
export function rectsOverlap(a: FloorRect, b: FloorRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Whether a rectangle lies entirely inside a `cols × rows` grid. */
export function rectInGrid(rect: FloorRect, cols: number, rows: number): boolean {
  return rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= cols && rect.y + rect.h <= rows;
}

/** Whether a cell is on the first or last column or row of the grid. */
export function isEdgeCell(cell: FloorCell, cols: number, rows: number): boolean {
  return cell.x === 0 || cell.y === 0 || cell.x === cols - 1 || cell.y === rows - 1;
}

const isInt = (value: unknown): value is number => Number.isInteger(value);
const cellRect = (cell: FloorCell): FloorRect => ({ x: cell.x, y: cell.y, w: 1, h: 1 });

/**
 * Problems of one area (kitchen or pickup counter).
 * @returns The problem, or null when it is a whole-cell rectangle of at least `areaMin` inside the grid.
 */
function areaProblem(rect: FloorRect, cols: number, rows: number): FloorPlanProblem | null {
  if (![rect.x, rect.y, rect.w, rect.h].every(isInt)) return "not_integer";
  if (rect.w < FLOOR_LIMITS.areaMin || rect.h < FLOOR_LIMITS.areaMin) return "area_too_small";
  if (!rectInGrid(rect, cols, rows)) return "out_of_bounds";
  return null;
}

/** Problems of the floors themselves: count, names, terrain codes and decoration kinds and count. */
function floorsProblem(floors: readonly FloorLevel[], cols: number, rows: number): FloorPlanProblem | null {
  if (!Array.isArray(floors) || floors.length < 1 || floors.length > FLOOR_LIMITS.floorsMax) return "invalid_floors";
  for (const level of floors) {
    const name = typeof level?.name === "string" ? level.name.trim() : "";
    if (name.length < 1 || name.length > FLOOR_LIMITS.floorNameMax) return "invalid_floors";
    if (level.terrain !== null) {
      if (typeof level.terrain !== "string" || level.terrain.length !== cols * rows) return "invalid_terrain";
      for (const code of level.terrain) if (!MATERIAL_BY_CODE.has(code)) return "invalid_terrain";
    }
    if (!Array.isArray(level.decor) || level.decor.length > FLOOR_LIMITS.decorMax) return "invalid_decor";
    if (
      level.decor.some((item: { kind?: unknown } | null) => !(DECOR_KINDS as readonly unknown[]).includes(item?.kind))
    ) {
      return "invalid_decor";
    }
  }
  return null;
}

/** Whether any cell of a rectangle is a wall or outside the building on that floor. */
function blocked(level: FloorLevel, cols: number, rect: FloorRect): boolean {
  return rectCells(rect).some((cell) => isBlockedMaterial(materialAt(level.terrain, cols, cell)));
}

/**
 * Validates a floor plan together with the tables placed on it: grid within FLOOR_LIMITS, a kitchen, areas of
 * whole cells inside the grid and apart from each other, the door on an edge and outside the areas, the floors
 * (names, painted terrain, decorations), and every table and decoration inside the grid, off walls and cells
 * outside the building, without sharing a cell with another one, an area or the door (areas and door are on
 * the first floor). Defensive about values typed by hand (it may receive anything the editor holds).
 * @param plan null = no plan: then no table may be placed. Without `floors` = one plain floor.
 * @param tables Every table to place, by id; entries with a null layout are not on the plan.
 * @returns The first problem found, or null when the plan can be saved.
 */
export function floorPlanProblem(
  plan: FloorPlanInput | null,
  tables: readonly { tableId: string; layout: TableLayout | TableLayoutInput | null }[],
): FloorPlanProblem | null {
  const ids = new Set<string>();
  for (const table of tables) {
    if (ids.has(table.tableId)) return "duplicate_table";
    ids.add(table.tableId);
  }
  const placed = tables.flatMap((t) => (t.layout ? [t.layout] : []));
  if (plan === null) return placed.length > 0 ? "table_without_plan" : null;

  const { cols, rows } = plan;
  if (
    !isInt(cols) ||
    !isInt(rows) ||
    cols < FLOOR_LIMITS.colsMin ||
    cols > FLOOR_LIMITS.colsMax ||
    rows < FLOOR_LIMITS.rowsMin ||
    rows > FLOOR_LIMITS.rowsMax
  ) {
    return "size";
  }
  if (!plan.kitchen) return "kitchen_required";

  const floors = plan.floors ?? defaultFloors();
  const floorsIssue = floorsProblem(floors, cols, rows);
  if (floorsIssue) return floorsIssue;
  const ground = floors[0]!;

  const areas = [plan.kitchen, ...(plan.pickup ? [plan.pickup] : [])];
  for (const area of areas) {
    const problem = areaProblem(area, cols, rows);
    if (problem) return problem;
  }
  if (plan.pickup && rectsOverlap(plan.kitchen, plan.pickup)) return "overlap";
  if (areas.some((area) => blocked(ground, cols, area))) return "blocked_cell";

  const door = plan.door;
  if (door) {
    if (!isInt(door.x) || !isInt(door.y)) return "not_integer";
    if (!rectInGrid(cellRect(door), cols, rows)) return "out_of_bounds";
    if (!isEdgeCell(door, cols, rows)) return "door_not_on_edge";
    if (areas.some((area) => rectsOverlap(area, cellRect(door)))) return "door_inside_area";
    // On a wall the door opens it; outside the building it would lead nowhere.
    if (materialAt(ground.terrain, cols, door) === "void") return "blocked_cell";
  }

  // Cells taken per floor. The door counts as taken: a table there would block the riders' way out.
  const taken: FloorRect[][] = floors.map(() => []);
  taken[0]!.push(...areas, ...(door ? [cellRect(door)] : []));
  for (const layout of placed) {
    if (
      !(TABLE_SHAPES as readonly unknown[]).includes(layout.shape) ||
      !(TABLE_SEATS as readonly unknown[]).includes(layout.seats) ||
      // Missing = horizontal (clients older than the rotation).
      (layout.rotation !== undefined && !(TABLE_ROTATIONS as readonly unknown[]).includes(layout.rotation))
    ) {
      return "invalid_table";
    }
    // Missing = first floor (clients older than the floors).
    const floor = layout.floor ?? 0;
    if (!isInt(floor) || floor < 0 || floor >= floors.length) return "unknown_floor";
    if (!isInt(layout.x) || !isInt(layout.y)) return "not_integer";
    const footprint = tableFootprint(layout);
    if (!rectInGrid(footprint, cols, rows)) return "out_of_bounds";
    if (blocked(floors[floor]!, cols, footprint)) return "blocked_cell";
    if (taken[floor]!.some((rect) => rectsOverlap(rect, footprint))) return "overlap";
    taken[floor]!.push(footprint);
  }

  for (const [index, level] of floors.entries()) {
    for (const item of level.decor) {
      if (!isInt(item.x) || !isInt(item.y)) return "not_integer";
      const cell = cellRect(item);
      if (!rectInGrid(cell, cols, rows)) return "out_of_bounds";
      if (blocked(level, cols, cell)) return "blocked_cell";
      if (taken[index]!.some((rect) => rectsOverlap(rect, cell))) return "overlap";
      taken[index]!.push(cell);
    }
  }
  return null;
}
