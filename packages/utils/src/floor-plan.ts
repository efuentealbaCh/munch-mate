import {
  type FloorCell,
  type FloorPlan,
  type FloorRect,
  FLOOR_LIMITS,
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
  | "table_without_plan";

/** Spanish (Chile) messages for each problem, shown by the api and the editor. */
export const FLOOR_PLAN_MESSAGES: Record<FloorPlanProblem, string> = {
  size: `El plano debe tener entre ${FLOOR_LIMITS.colsMin} y ${FLOOR_LIMITS.colsMax} columnas y entre ${FLOOR_LIMITS.rowsMin} y ${FLOOR_LIMITS.rowsMax} filas`,
  kitchen_required: "Ubica la cocina en el plano",
  not_integer: "Las posiciones y tamaños del plano deben ser celdas enteras",
  area_too_small: `La cocina y el mesón de retiro deben medir al menos ${FLOOR_LIMITS.areaMin}×${FLOOR_LIMITS.areaMin} celdas`,
  out_of_bounds: "Hay elementos fuera del plano; agrándalo o muévelos",
  overlap: "Hay elementos superpuestos en el plano (mesas, cocina, mesón de retiro o puerta)",
  door_not_on_edge: "La puerta de delivery debe estar en el borde del plano",
  door_inside_area: "La puerta de delivery no puede quedar dentro de la cocina ni del mesón de retiro",
  invalid_table: "Las mesas deben ser redondas o cuadradas, de 2, 4, 6 u 8 puestos, horizontales o verticales",
  duplicate_table: "Una mesa aparece dos veces en el plano",
  table_without_plan: "Dibuja el plano antes de ubicar las mesas",
};

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

/**
 * Validates a floor plan together with the tables placed on it: grid within FLOOR_LIMITS, a kitchen, areas of
 * whole cells inside the grid and apart from each other, the door on an edge and outside the areas, and every
 * table inside the grid without sharing a cell with another table, an area or the door. Defensive about
 * values typed by hand (it may receive anything the editor holds).
 * @param plan null = no plan: then no table may be placed.
 * @param tables Every table to place, by id; entries with a null layout are not on the plan.
 * @returns The first problem found, or null when the plan can be saved.
 */
export function floorPlanProblem(
  plan: FloorPlan | null,
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

  const areas = [plan.kitchen, ...(plan.pickup ? [plan.pickup] : [])];
  for (const area of areas) {
    const problem = areaProblem(area, cols, rows);
    if (problem) return problem;
  }
  if (plan.pickup && rectsOverlap(plan.kitchen, plan.pickup)) return "overlap";

  const door = plan.door;
  if (door) {
    if (!isInt(door.x) || !isInt(door.y)) return "not_integer";
    if (!rectInGrid(cellRect(door), cols, rows)) return "out_of_bounds";
    if (!isEdgeCell(door, cols, rows)) return "door_not_on_edge";
    if (areas.some((area) => rectsOverlap(area, cellRect(door)))) return "door_inside_area";
  }

  // The door counts as taken: a table there would block the riders' way out.
  const taken: FloorRect[] = [...areas, ...(door ? [cellRect(door)] : [])];
  for (const layout of placed) {
    if (
      !(TABLE_SHAPES as readonly unknown[]).includes(layout.shape) ||
      !(TABLE_SEATS as readonly unknown[]).includes(layout.seats) ||
      // Missing = horizontal (clients older than the rotation).
      (layout.rotation !== undefined && !(TABLE_ROTATIONS as readonly unknown[]).includes(layout.rotation))
    ) {
      return "invalid_table";
    }
    if (!isInt(layout.x) || !isInt(layout.y)) return "not_integer";
    const footprint = tableFootprint(layout);
    if (!rectInGrid(footprint, cols, rows)) return "out_of_bounds";
    if (taken.some((rect) => rectsOverlap(rect, footprint))) return "overlap";
    taken.push(footprint);
  }
  return null;
}
