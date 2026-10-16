import {
  type FloorCell,
  type FloorDecor,
  type FloorLevel,
  type FloorMaterial,
  FLOOR_MATERIALS,
  type FloorPlan,
  type FloorPlanView,
  type FloorRect,
  type LiveSummary,
  ORDER_STATUS_LABELS,
  type OrderChannel,
  type OrderStatus,
  type OrderView,
  type TableLayout,
  type TableRotation,
  type TableSessionView,
} from "@app/types";
import { defaultFloors, isBlockedMaterial, materialAt, tableFootprint } from "@app/utils";
import type { KeyValueStorage } from "./cart";
import { shortTableLabel, tableChairs } from "./floor-editor";
import { formatPrice } from "./money";
import { minutesSince } from "./orders-board";

/**
 * «En vivo» (phase 9): the restaurant drawn isometrically for the owner and the cashier. Everything here is
 * pure (no DOM): the projection and paint order of the scene, which zones are drawn, each table's state from
 * its open account, the kitchen tickets and their timers, and the texts of the indicators.
 */

// ── Isometric projection ────────────────────────────────────────────────────

/** Screen pixels per world unit (before the SVG viewBox scales the scene to its box). */
export const ISO_UNIT = 14;
/** World units per cell of the floor plan grid. */
export const CELL = 4;
const COS30 = Math.cos(Math.PI / 6);

/** A point of the world: x along the columns, y along the rows, z up (world units). */
export type Vec3 = readonly [x: number, y: number, z?: number];

/**
 * Isometric projection with both floor axes at 30°: +x goes down-right on screen, +y down-left, +z up. The
 * back walls are the x = 0 and y = 0 edges; what has a bigger x + y is closer to the viewer.
 * @returns Screen [x, y] in pixels.
 */
export function project(x: number, y: number, z = 0): [number, number] {
  return [(x - y) * COS30 * ISO_UNIT, ((x + y) * ISO_UNIT) / 2 - z * ISO_UNIT];
}

/** One decimal, enough for SVG coordinates (keeps the markup small). */
export function r1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** `points` attribute of a polygon through world points. */
export function isoPoints(points: readonly Vec3[]): string {
  return points
    .map(([x, y, z]) => {
      const [px, py] = project(x, y, z ?? 0);
      return `${r1(px)},${r1(py)}`;
    })
    .join(" ");
}

/** Darkens a #rrggbb color by `amount` (0–1). */
export function shade(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  return `#${[0, 2, 4]
    .map((i) => {
      const channel = Math.round(Number.parseInt(value.slice(i, i + 2), 16) * (1 - amount));
      return Math.max(0, Math.min(255, channel)).toString(16).padStart(2, "0");
    })
    .join("")}`;
}

/** Colors of the three visible faces of a box: top, left (+y face) and right (+x face). */
export interface Tone {
  t: string;
  l: string;
  r: string;
}

export function tone(base: string, left = 0.06, right = 0.14): Tone {
  return { t: base, l: shade(base, left), r: shade(base, right) };
}

/**
 * A closed ellipse on a horizontal plane (semi-axes `a` along x and `b` along y, world units), as a polygon
 * path plus its length (for progress rings drawn with stroke-dasharray). Starts at the back (−y) and goes
 * clockwise on screen.
 */
export function floorEllipse(cx: number, cy: number, a: number, b: number, z = 0, segments = 48): { d: string; length: number } {
  let d = "";
  let length = 0;
  let previous: [number, number] | null = null;
  for (let i = 0; i <= segments; i++) {
    const angle = -Math.PI / 2 + (i / segments) * Math.PI * 2;
    const point = project(cx + a * Math.cos(angle), cy + b * Math.sin(angle), z);
    d += `${i === 0 ? "M" : "L"}${r1(point[0])},${r1(point[1])} `;
    if (previous) length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    previous = point;
  }
  return { d: `${d.trim()} Z`, length };
}

/** Outline of a floor rectangle (world units), as a path. */
export function floorRectPath(x: number, y: number, w: number, h: number, z = 0): string {
  return `M${isoPoints([
    [x, y, z],
    [x + w, y, z],
    [x + w, y + h, z],
    [x, y + h, z],
  ]).replace(/ /g, " L")} Z`;
}

// ── Paint order ─────────────────────────────────────────────────────────────

/** A rectangle of whole cells (same shape as FloorRect). */
export type GridRect = FloorRect;

/** Horizontal screen span of a rectangle (proportional to x − y). */
function screenSpan(rect: GridRect): [number, number] {
  return [rect.x - (rect.y + rect.h), rect.x + rect.w - rect.y];
}

/**
 * Whether `a` must be painted before `b`: it lies entirely behind it along x or y and both share some
 * horizontal screen span (otherwise they never cover each other and the order does not matter).
 */
export function paintsBefore(a: GridRect, b: GridRect): boolean {
  const [a0, a1] = screenSpan(a);
  const [b0, b1] = screenSpan(b);
  if (a1 <= b0 || b1 <= a0) return false;
  return a.x + a.w <= b.x || a.y + a.h <= b.y;
}

/**
 * Painter's order for objects standing on disjoint cell rectangles. Sorting by the center's x + y fails with
 * long objects (a 1 × 6 counter and a table in front of its middle), so this is a topological sort over
 * {@link paintsBefore}, picking the nearest-to-the-back object first among the free ones (stable output).
 */
export function paintOrder<T>(items: readonly T[], rectOf: (item: T) => GridRect): T[] {
  const rects = items.map(rectOf);
  const depth = rects.map((r) => r.x + r.w / 2 + r.y + r.h / 2);
  const blockers = items.map(() => 0);
  const after: number[][] = items.map(() => []);
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (i !== j && paintsBefore(rects[i]!, rects[j]!) && !paintsBefore(rects[j]!, rects[i]!)) {
        after[i]!.push(j);
        blockers[j]! += 1;
      }
    }
  }
  const done = items.map(() => false);
  const order: T[] = [];
  for (let step = 0; step < items.length; step++) {
    let pick = -1;
    for (let i = 0; i < items.length; i++) {
      if (done[i] || blockers[i]! > 0) continue;
      if (pick === -1 || depth[i]! < depth[pick]!) pick = i;
    }
    // A cycle cannot happen with disjoint rectangles; if it ever did, fall back to the nearest one.
    if (pick === -1) {
      for (let i = 0; i < items.length; i++) if (!done[i] && (pick === -1 || depth[i]! < depth[pick]!)) pick = i;
    }
    done[pick] = true;
    order.push(items[pick]!);
    for (const j of after[pick]!) blockers[j]! -= 1;
  }
  return order;
}

// ── Which zones are drawn ───────────────────────────────────────────────────

/** A table drawn on the plan. */
export interface PlacedTable {
  id: string;
  label: string;
  layout: TableLayout;
  /** Cells it takes (tableFootprint). */
  rect: GridRect;
  /**
   * Sides of the table with chairs as seen on screen (`tableChairs`; a camera turned a quarter swaps them). Tables
   * of 4 seats on one cell are drawn with a chair on every side, so it only matters to 2 and 6–8 seats.
   */
  chairs: "top-bottom" | "left-right";
}

export interface LiveLayout {
  /** What is drawn: the owner's plan (or the default scene), without the zones the restaurant does not use. */
  plan: FloorPlan;
  /** Whether the owner drew a plan (false = default scene with only the kitchen and the enabled zones). */
  hasPlan: boolean;
  /** Dining room: a plan with at least one active table placed on it. */
  dining: boolean;
  /** Pickup counter: `pickupEnabled` and (with a plan) a counter on it. */
  pickup: boolean;
  /** Delivery door and riders mini-map: `deliveryEnabled` and (with a plan) a door on it. */
  delivery: boolean;
  tables: PlacedTable[];
  /**
   * Index in `plan.floors` of the floor drawn. The layout of the whole restaurant (`liveLayout`) has the tables
   * of every floor and says 0; `floorLayout` narrows it to one floor for the scene.
   */
  floor: number;
  /** Whether the floor drawn holds the kitchen, the pickup counter and the door (the first one). */
  ground: boolean;
}

/**
 * Scene used before the owner draws the plan: the kitchen and, when enabled, the pickup counter below it and
 * the delivery door on the front edge (a free column on the right keeps the restaurant's name and the door).
 * Valid for `floorPlanProblem`.
 */
export function defaultPlan(pickup: boolean, delivery: boolean): FloorPlan {
  const rows = pickup ? 7 : 5;
  return {
    cols: 8,
    rows,
    kitchen: { x: 0, y: 0, w: 5, h: 4 },
    pickup: pickup ? { x: 0, y: 4, w: 5, h: 3 } : null,
    door: delivery ? { x: 7, y: rows - 1 } : null,
    floors: defaultFloors(),
  };
}

/**
 * What the live view draws. Each zone only when the restaurant uses it: no plan or no active placed table →
 * no dining room; pickup off or no counter on the plan → no counter; delivery off or no door → no door nor
 * mini-map. The kitchen is always drawn (default scene without a plan).
 */
export function liveLayout(
  view: FloorPlanView | null,
  restaurant: { pickupEnabled: boolean; deliveryEnabled: boolean },
): LiveLayout {
  const own = view?.plan ?? null;
  const base = own ?? defaultPlan(restaurant.pickupEnabled, restaurant.deliveryEnabled);
  const pickup = restaurant.pickupEnabled && base.pickup !== null;
  const delivery = restaurant.deliveryEnabled && base.door !== null;
  const floors = base.floors?.length ? base.floors : defaultFloors();
  const tables: PlacedTable[] =
    own && view
      ? view.tables.flatMap((table) => {
          if (!table.active || !table.layout) return [];
          // A table on a floor the plan does not have (the api never saves one) is shown on the first floor.
          const { floor } = table.layout;
          const layout = Number.isInteger(floor) && floor >= 0 && floor < floors.length ? table.layout : { ...table.layout, floor: 0 };
          return [{ id: table.id, label: table.label, layout, rect: tableFootprint(layout), chairs: tableChairs(layout).sides }];
        })
      : [];
  return {
    plan: { ...base, pickup: pickup ? base.pickup : null, door: delivery ? base.door : null, floors },
    hasPlan: own !== null,
    dining: tables.length > 0,
    pickup,
    delivery,
    tables,
    floor: 0,
    ground: true,
  };
}

// ── Floors ──────────────────────────────────────────────────────────────────

/** A floor index made valid for a plan with `count` floors: unreadable → 0, past the last one → the last one. */
export function clampFloor(floor: number, count: number): number {
  if (!Number.isInteger(floor) || floor < 0 || count < 1) return 0;
  return Math.min(floor, count - 1);
}

/**
 * The layout of one floor, for the scene: only its tables, and the counter and the door only on the first floor
 * (the kitchen too: see `ground`). Its `dining` says whether that floor has tables. It commutes with
 * {@link rotateLayout}, so the scene may turn the whole layout once and then pick the floor.
 */
export function floorLayout(layout: LiveLayout, floor: number): LiveLayout {
  const index = clampFloor(floor, layout.plan.floors.length);
  const ground = index === 0;
  const tables = layout.tables.filter((table) => table.layout.floor === index);
  return {
    ...layout,
    plan: ground ? layout.plan : { ...layout.plan, pickup: null, door: null },
    dining: tables.length > 0,
    pickup: ground && layout.pickup,
    delivery: ground && layout.delivery,
    tables,
    floor: index,
    ground,
  };
}

/** One tab of the floor selector. */
export interface FloorTab {
  index: number;
  name: string;
  /** Active tables placed on it. */
  tables: number;
  /** Its tables calling the waiter, and asking for the bill (a table doing both counts in both). */
  waiter: number;
  bill: number;
  /** Its tables needing someone (calling the waiter or asking for the bill), each counted once: the tab's badge. */
  attention: number;
}

/**
 * The tabs of the floor selector, with the tables that need someone on each floor: a call on a floor that is not
 * on screen must not be missed.
 */
export function floorTabs(layout: LiveLayout, tableStates: ReadonlyMap<string, TableStatus>): FloorTab[] {
  const tabs: FloorTab[] = layout.plan.floors.map((level, index) => ({ index, name: level.name, tables: 0, waiter: 0, bill: 0, attention: 0 }));
  for (const table of layout.tables) {
    const tab = tabs[table.layout.floor];
    if (!tab) continue;
    tab.tables += 1;
    const state = tableStates.get(table.id);
    if (state?.waiter) tab.waiter += 1;
    if (state?.bill) tab.bill += 1;
    if (state?.waiter || state?.bill) tab.attention += 1;
  }
  return tabs;
}

const FLOOR_STORAGE_KEY = "mm:live-floor";

/**
 * The floor this device last looked at for this restaurant (0 when unknown or unreadable). Not clamped: the plan
 * may change meanwhile, so callers clamp it with {@link clampFloor} against the floors they have.
 */
export function loadLiveFloor(storage: KeyValueStorage | undefined, restaurantId: string): number {
  try {
    const raw = storage?.getItem(`${FLOOR_STORAGE_KEY}:${restaurantId}`);
    const value = raw ? Number(raw) : 0;
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function saveLiveFloor(storage: KeyValueStorage | undefined, restaurantId: string, floor: number): void {
  try {
    storage?.setItem(`${FLOOR_STORAGE_KEY}:${restaurantId}`, String(floor));
  } catch {
    // Private mode or full storage: the choice lasts until the page closes.
  }
}

// ── Terrain ─────────────────────────────────────────────────────────────────

/** A run of cells of one row (`x` to `x + w − 1` on row `y`). */
export interface CellRun {
  x: number;
  y: number;
  w: number;
}

/** A run of cells of the same material (void cells never form runs: nothing is drawn outside the building). */
export interface TerrainRun extends CellRun {
  material: Exclude<FloorMaterial, "void">;
}

/**
 * The cells of a floor as runs of the same material along each row, back to front: few shapes even on a 24 × 16
 * plan. Void cells are skipped.
 */
export function terrainRuns(terrain: string | null, cols: number, rows: number): TerrainRun[] {
  const runs: TerrainRun[] = [];
  for (let y = 0; y < rows; y++) {
    let current: TerrainRun | null = null;
    for (let x = 0; x < cols; x++) {
      const material = materialAt(terrain, cols, { x, y });
      if (material === "void") {
        current = null;
      } else if (current && current.material === material) {
        current.w += 1;
      } else {
        current = { x, y, w: 1, material };
        runs.push(current);
      }
    }
  }
  return runs;
}

/** Runs of cells inside the building (any material but void) per row: where the slab under the floor goes. */
export function buildingRuns(terrain: string | null, cols: number, rows: number): CellRun[] {
  const runs: CellRun[] = [];
  for (let y = 0; y < rows; y++) {
    let current: CellRun | null = null;
    for (let x = 0; x < cols; x++) {
      if (materialAt(terrain, cols, { x, y }) === "void") {
        current = null;
      } else if (current) {
        current.w += 1;
      } else {
        current = { x, y, w: 1 };
        runs.push(current);
      }
    }
  }
  return runs;
}

/** Whether a floor has cells outside the building (then its slab is drawn row by row instead of as one block). */
export function hasVoid(terrain: string | null): boolean {
  return terrain !== null && terrain.includes(FLOOR_MATERIALS.void);
}

/** Whether a cell of a floor is inside the building (not void). */
export function isInside(terrain: string | null, cols: number, cell: FloorCell): boolean {
  return materialAt(terrain, cols, cell) !== "void";
}

/**
 * Wall cells of a floor as runs along each row (each run is drawn as one raised block). The door's cell is left
 * out: a door on a wall opens it.
 */
export function wallRuns(terrain: string | null, cols: number, rows: number, door: FloorCell | null = null): CellRun[] {
  return terrainRuns(terrain, cols, rows)
    .filter((run) => run.material === "wall")
    .flatMap(({ x, y, w }) => {
      if (!door || door.y !== y || door.x < x || door.x >= x + w) return [{ x, y, w }];
      return [
        { x, y, w: door.x - x },
        { x: door.x + 1, y, w: x + w - door.x - 1 },
      ].filter((run) => run.w > 0);
    });
}

/** Side of a building cell facing a void cell. */
export type EdgeSide = "north" | "south" | "west" | "east";

/** A run of edges facing void cells: along x (from `x`) for north/south, along y (from `y`) for west/east. */
export interface VoidEdge {
  side: EdgeSide;
  x: number;
  y: number;
  length: number;
}

const EDGE_SIDES: readonly { side: EdgeSide; dx: number; dy: number }[] = [
  { side: "north", dx: 0, dy: -1 },
  { side: "south", dx: 0, dy: 1 },
  { side: "west", dx: -1, dy: 0 },
  { side: "east", dx: 1, dy: 0 },
];

/**
 * The inner outline of the building: edges between a building cell and a void cell of the grid, merged into runs.
 * The scene puts a low curb on them so an L-shaped place reads as one building; the grid's own edges keep the
 * walls of an unpainted plan.
 */
export function voidEdges(terrain: string | null, cols: number, rows: number): VoidEdge[] {
  if (!hasVoid(terrain)) return [];
  const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  const edges: VoidEdge[] = [];
  for (const { side, dx, dy } of EDGE_SIDES) {
    const alongX = dy !== 0;
    for (let a = 0; a < (alongX ? rows : cols); a++) {
      let run: VoidEdge | null = null;
      for (let b = 0; b < (alongX ? cols : rows); b++) {
        const x = alongX ? b : a;
        const y = alongX ? a : b;
        const edge = isInside(terrain, cols, { x, y }) && inGrid(x + dx, y + dy) && !isInside(terrain, cols, { x: x + dx, y: y + dy });
        if (!edge) {
          run = null;
        } else if (run) {
          run.length += 1;
        } else {
          run = { side, x, y, length: 1 };
          edges.push(run);
        }
      }
    }
  }
  return edges;
}

/**
 * The thin rectangle a curb is painted by (see {@link paintOrder}): just outside its cells, on the void side, so
 * it goes after what stands behind it and before what stands on its own cells (void cells hold nothing).
 */
export function voidEdgeRect(edge: VoidEdge): GridRect {
  const t = 0.1;
  switch (edge.side) {
    case "north":
      return { x: edge.x, y: edge.y - t, w: edge.length, h: t };
    case "south":
      return { x: edge.x, y: edge.y + 1, w: edge.length, h: t };
    case "west":
      return { x: edge.x - t, y: edge.y, w: t, h: edge.length };
    default:
      return { x: edge.x + 1, y: edge.y, w: t, h: edge.length };
  }
}

/** The floor drawn by a layout (its terrain and decorations); a plain floor when the plan has none. */
export function drawnLevel(layout: Pick<LiveLayout, "plan" | "floor">): FloorLevel {
  return layout.plan.floors[layout.floor] ?? { name: "", terrain: null, decor: [] };
}

// ── Camera ──────────────────────────────────────────────────────────────────

/** Quarter turns of the camera: 0 = the plan as the owner drew it, then 90°, 180° and 270° clockwise. */
export type CameraTurns = 0 | 1 | 2 | 3;

/** Any whole number of quarter turns (negative too) as 0–3. */
export function normalizeTurns(quarterTurns: number): CameraTurns {
  const turns = Number.isFinite(quarterTurns) ? Math.trunc(quarterTurns) : 0;
  return (((turns % 4) + 4) % 4) as CameraTurns;
}

/** «Girar a la izquierda» (−1) / «Girar a la derecha» (+1). */
export function turnCamera(turns: CameraTurns, delta: -1 | 1): CameraTurns {
  return normalizeTurns(turns + delta);
}

/** Degrees of the camera (0, 90, 180, 270). */
export function cameraAngle(turns: CameraTurns): number {
  return turns * 90;
}

/**
 * One quarter turn clockwise (seen from above) of a cell of a grid with `rows` rows: the first row becomes the
 * last column. The turned grid has the columns and rows swapped.
 */
export function turnCell(cell: FloorCell, rows: number): FloorCell {
  return { x: rows - 1 - cell.y, y: cell.x };
}

/** One quarter turn clockwise of a rectangle of cells (see {@link turnCell}): its width and depth swap. */
export function turnRect(rect: GridRect, rows: number): GridRect {
  return { x: rows - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w };
}

/** One quarter turn clockwise of a floor's painted terrain (see {@link turnCell}): `cols × rows` becomes `rows × cols`. */
export function turnTerrain(terrain: string | null, cols: number, rows: number): string | null {
  if (terrain === null) return null;
  let turned = "";
  // Cell (x', y') of the turned grid comes from (y', rows − 1 − x'): the inverse of turnCell.
  for (let y = 0; y < cols; y++) for (let x = 0; x < rows; x++) turned += FLOOR_MATERIALS[materialAt(terrain, cols, { x: y, y: rows - 1 - x })];
  return turned;
}

/** One quarter turn clockwise of a floor: its terrain and its decorations. */
function turnLevel(level: FloorLevel, cols: number, rows: number): FloorLevel {
  return {
    ...level,
    terrain: turnTerrain(level.terrain, cols, rows),
    decor: level.decor.map((item): FloorDecor => ({ ...item, ...turnCell(item, rows) })),
  };
}

/**
 * The plan as the camera sees it after `quarterTurns` clockwise quarter turns: the grid turned (cols and rows
 * swapped on 90° and 270°), the kitchen, counter and door moved to their turned cells, the painted terrain and the
 * decorations of every floor turned with them, and each table on its turned footprint. A long table turns from horizontal to vertical and back (its view `rotation` alternates),
 * and the sides of its chairs swap. Only the camera turns: the saved plan never changes. Four turns give the
 * same plan back. Then the scene draws it as always: the walls of the x = 0 and y = 0 edges stay at the back.
 */
export function rotatePlanView<T extends PlacedTable>(plan: FloorPlan, tables: readonly T[], quarterTurns: number): { plan: FloorPlan; tables: T[] } {
  let current = { plan, tables: [...tables] };
  for (let turn = 0; turn < normalizeTurns(quarterTurns); turn++) {
    const { rows } = current.plan;
    current = {
      plan: {
        cols: current.plan.rows,
        rows: current.plan.cols,
        kitchen: turnRect(current.plan.kitchen, rows),
        pickup: current.plan.pickup ? turnRect(current.plan.pickup, rows) : null,
        door: current.plan.door ? turnCell(current.plan.door, rows) : null,
        floors: current.plan.floors.map((level) => turnLevel(level, current.plan.cols, rows)),
      },
      tables: current.tables.map((table) => {
        const rect = turnRect(table.rect, rows);
        const rotation: TableRotation = table.layout.rotation === 90 ? 0 : 90;
        const chairs: PlacedTable["chairs"] = table.chairs === "top-bottom" ? "left-right" : "top-bottom";
        return { ...table, rect, layout: { ...table.layout, x: rect.x, y: rect.y, rotation }, chairs } as T;
      }),
    };
  }
  return current;
}

/** The live layout seen from the camera (only the plan and the tables move; the zones in use stay). */
export function rotateLayout(layout: LiveLayout, quarterTurns: number): LiveLayout {
  if (normalizeTurns(quarterTurns) === 0) return layout;
  const turned = rotatePlanView(layout.plan, layout.tables, quarterTurns);
  return { ...layout, plan: turned.plan, tables: turned.tables };
}

const CAMERA_STORAGE_KEY = "mm:live-camera";

/** The camera angle this device last used for this restaurant (0 when unknown or unreadable). */
export function loadCameraTurns(storage: KeyValueStorage | undefined, restaurantId: string): CameraTurns {
  try {
    const raw = storage?.getItem(`${CAMERA_STORAGE_KEY}:${restaurantId}`);
    const value = raw ? Number(raw) : 0;
    return Number.isInteger(value) ? normalizeTurns(value) : 0;
  } catch {
    return 0;
  }
}

export function saveCameraTurns(storage: KeyValueStorage | undefined, restaurantId: string, turns: CameraTurns): void {
  try {
    storage?.setItem(`${CAMERA_STORAGE_KEY}:${restaurantId}`, String(turns));
  } catch {
    // Private mode or full storage: the angle lasts until the page closes.
  }
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** Color of the table top: nobody, waiting for the kitchen, or served. */
export type TableBase = "free" | "kitchen" | "eating";
/** What the table's pin shows (the most urgent of its states). */
export type TableIndicator = "waiter" | "bill" | "paying" | TableBase;

export const TABLE_STATE_LABELS: Record<TableIndicator, string> = {
  free: "Libre",
  kitchen: "Pedido en cocina",
  eating: "Comiendo",
  waiter: "Llamó al garzón",
  bill: "Pidió la cuenta",
  paying: "Pagando por partes",
};

/** Scene colors (the SVG paints plain colors; same palette as the approved mock-up). */
export const TABLE_COLORS: Record<TableBase, { top: string; side: string; badge: string }> = {
  free: { top: "#efedeb", side: "#d6d3d1", badge: "#a8a29e" },
  kitchen: { top: "#fbd9c4", side: "#eab08f", badge: "#c2410c" },
  eating: { top: "#cdebd6", side: "#97cca8", badge: "#15803d" },
};
export const ALERT_COLORS = { waiter: "#d97706", bill: "#c2410c", paying: "#15803d" } as const;

export interface TableStatus {
  base: TableBase;
  indicator: TableIndicator;
  /** Every state that applies (a table may call the waiter while paying in parts). */
  waiter: boolean;
  bill: boolean;
  paying: boolean;
  /** Since when the indicator applies: the call, the bill request or when the account opened; null when free. */
  since: string | null;
  /** Share paid of the account (0–1) while paying in parts; null otherwise. */
  paidFraction: number | null;
  session: TableSessionView | null;
}

/**
 * State of a table from its open account. Priority of the pin when several apply: called the waiter > asked
 * for the bill > paying in parts > order in the kitchen > eating.
 */
export function tableStatus(session: TableSessionView | null | undefined): TableStatus {
  const open = session && session.status === "open" ? session : null;
  if (!open) return { base: "free", indicator: "free", waiter: false, bill: false, paying: false, since: null, paidFraction: null, session: null };
  const base: TableBase = open.ordersInProgress > 0 ? "kitchen" : open.orderCount > 0 ? "eating" : "free";
  const waiter = open.waiterCalledAt !== null;
  const bill = open.billRequestedAt !== null;
  const paying = open.payments.length > 0;
  const indicator: TableIndicator = waiter ? "waiter" : bill ? "bill" : paying ? "paying" : base;
  const total = open.paid + open.remaining;
  return {
    base,
    indicator,
    waiter,
    bill,
    paying,
    since: waiter ? open.waiterCalledAt : bill ? open.billRequestedAt : base === "free" && !paying ? null : open.openedAt,
    paidFraction: paying ? (total > 0 ? Math.min(1, open.paid / total) : 1) : null,
    session: open,
  };
}

/**
 * What the table's badge shows, the same short name as the floor plan editor ("Mesa 12" → "12", "Terraza 3" →
 * "T3", so "Terraza 1" never looks like "Mesa 1"), cut to 4 characters for the small badge.
 */
export function shortLabel(label: string): string {
  return shortTableLabel(label.trim()).slice(0, 4);
}

/**
 * Chip next to a table paying in parts: "1/3 pagado" with equal parts, else the share paid ("40 % pagado").
 * @returns null when the account has no payments.
 */
export function payingChip(session: Pick<TableSessionView, "payments" | "split" | "paid" | "remaining">): string | null {
  if (session.payments.length === 0) return null;
  if (session.split?.mode === "equal") {
    const parts = new Set(session.payments.flatMap((p) => (p.kind === "equal" && p.part !== null ? [p.part] : []))).size;
    if (parts > 0) return `${parts}/${session.split.parts} pagado`;
  }
  const total = session.paid + session.remaining;
  return `${total > 0 ? Math.min(100, Math.round((session.paid / total) * 100)) : 100} % pagado`;
}

/** Shortens a text for the drawing (SVG text does not wrap): "Fernanda Gutiérrez" → "Fernanda Gutié…". */
export function ellipsize(text: string, max: number): string {
  const chars = Array.from(text.trim());
  return chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join("")}…` : chars.join("");
}

/** Open accounts by table id (closed ones are ignored). */
export function sessionsByTable(sessions: readonly TableSessionView[]): Map<string, TableSessionView> {
  const map = new Map<string, TableSessionView>();
  for (const session of sessions) if (session.status === "open") map.set(session.tableId, session);
  return map;
}

// ── Kitchen tickets ─────────────────────────────────────────────────────────

export type KitchenGroupKey = "pending" | "preparing" | "ready";

export const KITCHEN_GROUPS: readonly { key: KitchenGroupKey; label: string; color: string; statuses: readonly OrderStatus[] }[] = [
  { key: "pending", label: "Pendiente", color: "#b45309", statuses: ["pending"] },
  // Accepted orders are already the kitchen's: they wait with the ones being prepared.
  { key: "preparing", label: "En preparación", color: "#c2410c", statuses: ["accepted", "preparing"] },
  { key: "ready", label: "Listo", color: "#15803d", statuses: ["ready"] },
];

/** Tickets shown per group over the kitchen; the rest are summarized as «+N». */
export const TICKETS_PER_GROUP = 3;

/** When the order entered its current status (the last entry of its history). */
export function statusSince(order: Pick<OrderView, "statusHistory" | "createdAt">): string {
  return order.statusHistory.at(-1)?.at ?? order.createdAt;
}

/** Units of an order (Σ quantities). */
export function unitCount(order: Pick<OrderView, "items">): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

/** "Mesa 4", "Retiro" or "Delivery". */
export function channelPlace(order: Pick<OrderView, "channel" | "tableLabel">): string {
  if (order.channel === "dine_in") return order.tableLabel ?? "Mesa";
  return order.channel === "pickup" ? "Retiro" : "Delivery";
}

/** The customer's name, or "3 ítems" when there is none (table orders). */
export function orderWho(order: Pick<OrderView, "customerName" | "items">): string {
  const name = order.customerName.trim();
  if (name) return name;
  const units = unitCount(order);
  return `${units} ${units === 1 ? "ítem" : "ítems"}`;
}

export interface KitchenTicket {
  order: OrderView;
  /** Whole minutes in its current status (the ticket's timer). */
  minutes: number;
  /** The timer went over the kitchen goal. */
  late: boolean;
}

export interface KitchenGroup {
  key: KitchenGroupKey;
  label: string;
  color: string;
  /** Oldest first: the one waiting the longest leads. */
  tickets: KitchenTicket[];
  /** The first TICKETS_PER_GROUP. */
  shown: KitchenTicket[];
  /** How many more («+N»). */
  hidden: number;
}

/** A ticket's timer against the kitchen goal. */
export function ticketTimer(order: Pick<OrderView, "statusHistory" | "createdAt">, now: number, targetMinutes: number): { minutes: number; late: boolean } {
  const minutes = minutesSince(statusSince(order), now);
  return { minutes, late: minutes >= targetMinutes };
}

/**
 * Active orders grouped as the kitchen sees them: Pendiente, En preparación (accepted or preparing) and
 * Listo; each oldest first, with its timer.
 */
export function kitchenGroups(orders: readonly OrderView[], now: number, targetMinutes: number, perGroup = TICKETS_PER_GROUP): KitchenGroup[] {
  return KITCHEN_GROUPS.map((group) => {
    const tickets = orders
      .filter((order) => group.statuses.includes(order.status))
      .sort((a, b) => statusSince(a).localeCompare(statusSince(b)) || a.ticketNumber - b.ticketNumber)
      .map((order) => ({ order, ...ticketTimer(order, now, targetMinutes) }));
    return {
      key: group.key,
      label: group.label,
      color: group.color,
      tickets,
      shown: tickets.slice(0, perGroup),
      hidden: Math.max(0, tickets.length - perGroup),
    };
  });
}

/** "8 min" (the ticket timer). */
export function timerLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Orders of the kitchen (pending to ready), any channel. */
export function inKitchen(orders: readonly OrderView[]): OrderView[] {
  return orders.filter((order) => KITCHEN_GROUPS.some((group) => group.statuses.includes(order.status)));
}

/** Pickup orders waiting on the counter, the oldest first. */
export function readyPickups(orders: readonly OrderView[]): OrderView[] {
  return orders
    .filter((order) => order.channel === "pickup" && order.status === "ready")
    .sort((a, b) => statusSince(a).localeCompare(statusSince(b)));
}

/** Active pickup orders: ready ones first, then the ones still in the kitchen (oldest first). */
export function pickupQueue(orders: readonly OrderView[]): OrderView[] {
  const rest = orders
    .filter((order) => order.channel === "pickup" && order.status !== "ready")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...readyPickups(orders), ...rest];
}

/** Deliveries on their way (one motorbike each at the door), the earliest to leave first. */
export function onTheWay(orders: readonly OrderView[]): OrderView[] {
  return orders
    .filter((order) => order.channel === "delivery" && order.status === "out_for_delivery")
    .sort((a, b) => statusSince(a).localeCompare(statusSince(b)));
}

/** Active deliveries: on their way, then ready to leave, then in the kitchen. */
export function deliveryQueue(orders: readonly OrderView[]): OrderView[] {
  const rank = (status: OrderStatus) => (status === "out_for_delivery" ? 0 : status === "ready" ? 1 : 2);
  return orders
    .filter((order) => order.channel === "delivery")
    .sort((a, b) => rank(a.status) - rank(b.status) || statusSince(a).localeCompare(statusSince(b)));
}

// ── Order tracking (the strip under the scene) ──────────────────────────────

const FLOWS: Record<OrderChannel, readonly OrderStatus[]> = {
  dine_in: ["pending", "accepted", "preparing", "ready", "served"],
  pickup: ["pending", "accepted", "preparing", "ready", "picked_up"],
  delivery: ["pending", "accepted", "preparing", "ready", "out_for_delivery", "delivered"],
};

export interface TrackingStep {
  status: OrderStatus;
  label: string;
  state: "done" | "current" | "todo";
  /** When it happened (last time it entered that status), or the estimate for a future step; null if unknown. */
  at: string | null;
  /** `at` is the estimate given when accepting (pickup ready / delivery arrival). */
  estimated: boolean;
}

/** The steps of an order's channel with what already happened. Steps skipped by the staff count as done. */
export function trackingSteps(order: Pick<OrderView, "channel" | "status" | "statusHistory" | "estimatedReadyAt">): TrackingStep[] {
  const flow = FLOWS[order.channel];
  const current = flow.indexOf(order.status);
  const reached = new Map<OrderStatus, string>();
  for (const change of order.statusHistory) reached.set(change.status, change.at);
  const estimateStep: OrderStatus = order.channel === "delivery" ? "delivered" : order.channel === "pickup" ? "ready" : "served";
  return flow.map((status, index) => {
    const state = current === -1 ? (reached.has(status) ? "done" : "todo") : index < current ? "done" : index === current ? "current" : "todo";
    const estimated = state === "todo" && status === estimateStep && order.estimatedReadyAt !== null && order.channel !== "dine_in";
    return {
      status,
      label: ORDER_STATUS_LABELS[status],
      state,
      at: state === "todo" ? (estimated ? order.estimatedReadyAt : null) : (reached.get(status) ?? null),
      estimated,
    };
  });
}

/**
 * The order the tracking strip follows when nothing is selected: with delivery, the delivery that left last
 * (else the newest active delivery); otherwise, or without deliveries, the newest active order of any channel.
 */
export function featuredOrder(orders: readonly OrderView[], delivery: boolean): OrderView | null {
  const newest = (list: readonly OrderView[], key: (order: OrderView) => string) =>
    list.reduce<OrderView | null>((best, order) => (best === null || key(order) > key(best) ? order : best), null);
  if (delivery) {
    const out = newest(onTheWay(orders), statusSince);
    if (out) return out;
    const any = newest(
      orders.filter((order) => order.channel === "delivery"),
      (order) => order.createdAt,
    );
    if (any) return any;
  }
  return newest(orders, (order) => order.createdAt);
}

// ── Selection ───────────────────────────────────────────────────────────────

/** What the detail panel shows; also the `data-id` of the scene's elements. */
export type LiveTarget = { kind: "kitchen" } | { kind: "pickup" } | { kind: "door" } | { kind: "table"; id: string } | { kind: "order"; id: string };

export function targetKey(target: LiveTarget): string {
  return target.kind === "table" || target.kind === "order" ? `${target.kind}:${target.id}` : target.kind;
}

export function parseTarget(key: string | null | undefined): LiveTarget | null {
  if (key === "kitchen" || key === "pickup" || key === "door") return { kind: key };
  const match = /^(table|order):([\w-]+)$/.exec(key ?? "");
  if (!match) return null;
  return { kind: match[1] as "table" | "order", id: match[2]! };
}

/**
 * Keeps the selection while it still exists (a table on the plan, an active order, a drawn zone); otherwise
 * falls back to the kitchen, which is always there.
 */
export function resolveTarget(target: LiveTarget | null, layout: LiveLayout, orders: readonly OrderView[]): LiveTarget {
  if (!target) return { kind: "kitchen" };
  switch (target.kind) {
    case "table":
      return layout.tables.some((t) => t.id === target.id) ? target : { kind: "kitchen" };
    case "order":
      return orders.some((o) => o.id === target.id) ? target : { kind: "kitchen" };
    case "pickup":
      return layout.pickup ? target : { kind: "kitchen" };
    case "door":
      return layout.delivery ? target : { kind: "kitchen" };
    default:
      return target;
  }
}

// ── Indicators ──────────────────────────────────────────────────────────────

/** "+12 %", "−5 %", "0 %" against last week; null without sales then. */
export function changeLabel(changePercent: number | null): { text: string; trend: "up" | "down" | "flat" } | null {
  if (changePercent === null) return null;
  if (changePercent > 0) return { text: `+${changePercent} %`, trend: "up" };
  if (changePercent < 0) return { text: `−${Math.abs(changePercent)} %`, trend: "down" };
  return { text: "0 %", trend: "flat" };
}

/** Weekday of an instant in the restaurant's time zone ("viernes"). */
export function weekdayName(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("es-CL", { weekday: "long", timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("es-CL", { weekday: "long" }).format(new Date(iso));
  }
}

/** Subtitle of the sales card: "+12 % vs el viernes pasado" (or why there is no comparison). */
export function salesComparison(summary: Pick<LiveSummary, "at" | "sales">, timeZone: string): { change: ReturnType<typeof changeLabel>; text: string } {
  const day = weekdayName(summary.at, timeZone);
  const change = changeLabel(summary.sales.changePercent);
  return change ? { change, text: `vs el ${day} pasado` } : { change: null, text: `Sin ventas el ${day} pasado a esta hora` };
}

/**
 * Sparkline of today's sales so far (running total per hour) in a `width × height` box.
 * @returns The line and the filled area paths; null with fewer than two hours.
 */
export function sparkline(hourly: readonly { hour: number; total: number }[], width: number, height: number): { line: string; area: string } | null {
  if (hourly.length < 2) return null;
  let running = 0;
  const cumulative = hourly.map((h) => (running += h.total));
  const max = Math.max(...cumulative);
  const points = cumulative.map((value, i) => [
    (i * width) / (cumulative.length - 1),
    height - 3 - (max > 0 ? (value / max) * (height - 6) : 0),
  ]);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x!.toFixed(1)},${y!.toFixed(1)}`).join(" ");
  return { line, area: `${line} L${width},${height} L0,${height} Z` };
}

export const CHANNEL_SHORT: Record<OrderChannel, string> = { dine_in: "mesa", pickup: "retiro", delivery: "delivery" };
export const CHANNEL_COLORS: Record<OrderChannel, string> = { dine_in: "#c2410c", pickup: "#d97706", delivery: "#2563eb" };

/**
 * Orders in progress per channel for the card: only the channels the restaurant uses (or that still have
 * orders), e.g. "6 mesa · 4 retiro · 4 delivery".
 */
export function inProgressBreakdown(
  inProgress: LiveSummary["inProgress"],
  channels: readonly OrderChannel[],
): { parts: { channel: OrderChannel; count: number; color: string }[]; text: string } {
  const parts = (["dine_in", "pickup", "delivery"] as const)
    .filter((channel) => channels.includes(channel) || inProgress[channel] > 0)
    .map((channel) => ({ channel, count: inProgress[channel], color: CHANNEL_COLORS[channel] }));
  return { parts, text: parts.map((p) => `${p.count} ${CHANNEL_SHORT[p.channel]}`).join(" · ") };
}

/** The kitchen card: average against the goal, as a meter whose full width is 1.5 × the goal. */
export function kitchenGauge(kitchen: LiveSummary["kitchen"]): {
  value: string;
  status: "ok" | "over" | "none";
  text: string;
  fillPercent: number;
  targetPercent: number;
} {
  const scale = kitchen.targetMinutes * 1.5;
  const targetPercent = Math.round((kitchen.targetMinutes / scale) * 1000) / 10;
  if (kitchen.averageMinutes === null) {
    return { value: "—", status: "none", text: `Meta ${kitchen.targetMinutes} min · sin pedidos listos hoy`, fillPercent: 0, targetPercent };
  }
  const over = kitchen.averageMinutes > kitchen.targetMinutes;
  return {
    value: String(kitchen.averageMinutes),
    status: over ? "over" : "ok",
    text: `Meta ${kitchen.targetMinutes} min · ${over ? "sobre la meta" : "dentro de la meta"}`,
    fillPercent: Math.min(100, Math.round((kitchen.averageMinutes / scale) * 1000) / 10),
    targetPercent,
  };
}

/** Tables card: "1 llamado · 1 cuenta pedida · 1 pagando por partes" and one square per placed table (max 16). */
export function tablesSummary(tables: LiveSummary["tables"]): { text: string; squares: boolean[] } {
  const parts = [
    tables.callingWaiter > 0 ? `${tables.callingWaiter} ${tables.callingWaiter === 1 ? "llamado" : "llamados"}` : null,
    tables.billRequested > 0 ? `${tables.billRequested} ${tables.billRequested === 1 ? "cuenta pedida" : "cuentas pedidas"}` : null,
    tables.payingInParts > 0 ? `${tables.payingInParts} pagando por partes` : null,
  ].filter((p): p is string => p !== null);
  const text = parts.length > 0 ? parts.join(" · ") : tables.occupied === 0 ? "Todas libres" : "Sin llamados";
  const shown = Math.min(16, tables.positioned);
  const on = tables.positioned > 0 ? Math.round((Math.min(tables.occupied, tables.positioned) / tables.positioned) * shown) : 0;
  return { text, squares: Array.from({ length: shown }, (_, i) => i < on) };
}

/** "$1.284.560": money of the indicators. */
export function moneyLabel(amount: number, currency: string): string {
  return formatPrice(amount, currency);
}

// ── Scene geometry ──────────────────────────────────────────────────────────

/** Size of the kitchen drawing (world units), as in the approved mock-up; scaled to fit the plan's kitchen. */
export const KITCHEN_ART = { w: 15.6, h: 12 } as const;
/** Size of the pickup counter drawing (world units). */
export const PICKUP_ART = { w: 15, h: 9 } as const;
/** Scale of the table drawings (the mock-up's tables) so a table with its chairs fits one cell. */
export const TABLE_SCALE = 0.78;
/** Height of the back walls (world units). */
export const WALL_HEIGHT = 4;
/** Height of the walls the owner paints inside the plan: low, so the tables behind them stay in sight. */
export const WALL_BLOCK_HEIGHT = 1.4;

/** Where a drawing goes in the world: its origin and its uniform scale. */
export interface ArtPlacement {
  x: number;
  y: number;
  scale: number;
}

/**
 * Fits a drawing into a rectangle of cells with one uniform scale (a projected drawing scaled uniformly is
 * still isometric), centered along x and either centered or against the back (low y) along y.
 */
export function fitArt(rect: GridRect, art: { w: number; h: number }, align: "center" | "back", maxScale = 1.25): ArtPlacement {
  const width = rect.w * CELL;
  const depth = rect.h * CELL;
  const scale = Math.min(width / art.w, depth / art.h, maxScale);
  return {
    x: rect.x * CELL + (width - art.w * scale) / 2,
    y: rect.y * CELL + (align === "back" ? 0 : (depth - art.h * scale) / 2),
    scale,
  };
}

/** Screen point of a point of a placed drawing (local world units). */
export function artPoint(placement: ArtPlacement, x: number, y: number, z = 0): [number, number] {
  return project(placement.x + x * placement.scale, placement.y + y * placement.scale, z * placement.scale);
}

/** Which edge the delivery door is on: the front ones (east = last column, south = last row) win at corners. */
export type DoorSide = "east" | "south" | "west" | "north";

export function doorSide(door: FloorCell, cols: number, rows: number): DoorSide {
  if (door.x === cols - 1) return "east";
  if (door.y === rows - 1) return "south";
  if (door.x === 0) return "west";
  return "north";
}

/**
 * Cells taken on a floor ("x,y" keys): tables, decorations, walls and cells outside the building, and on the first
 * floor the areas and the door.
 */
export function takenCells(plan: FloorPlan, tables: readonly { rect: GridRect }[], floor = 0): Set<string> {
  const taken = new Set<string>();
  const add = (rect: GridRect) => {
    for (let x = rect.x; x < rect.x + rect.w; x++) for (let y = rect.y; y < rect.y + rect.h; y++) taken.add(`${x},${y}`);
  };
  if (floor === 0) {
    add(plan.kitchen);
    if (plan.pickup) add(plan.pickup);
    if (plan.door) add({ ...plan.door, w: 1, h: 1 });
  }
  for (const table of tables) add(table.rect);
  const level = plan.floors[floor];
  if (level) {
    for (const item of level.decor) add({ x: item.x, y: item.y, w: 1, h: 1 });
    if (level.terrain) {
      for (let y = 0; y < plan.rows; y++) {
        for (let x = 0; x < plan.cols; x++) if (isBlockedMaterial(materialAt(level.terrain, plan.cols, { x, y }))) taken.add(`${x},${y}`);
      }
    }
  }
  return taken;
}

/** Longest run of indices in [0, length) for which `free` holds. */
function longestRun(length: number, free: (i: number) => boolean): { start: number; length: number } {
  let best = { start: 0, length: 0 };
  let start = -1;
  for (let i = 0; i <= length; i++) {
    if (i < length && free(i)) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      if (i - start > best.length) best = { start, length: i - start };
      start = -1;
    }
  }
  return best;
}

/**
 * Where the restaurant's name is painted: the longest stretch of a back wall (north = y 0, west = x 0) with no
 * kitchen or counter against it (their drawings are tall) and inside the building (no back wall over void cells).
 * In cells.
 */
export function nameSpot(plan: FloorPlan, floor = 0): { wall: "north" | "west"; start: number; length: number } | null {
  const areas = floor === 0 ? [plan.kitchen, ...(plan.pickup ? [plan.pickup] : [])] : [];
  const terrain = plan.floors[floor]?.terrain ?? null;
  const against = (x: number, y: number) =>
    areas.some((a) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h) || !isInside(terrain, plan.cols, { x, y });
  const doorAt = (x: number, y: number) => floor === 0 && plan.door !== null && plan.door.x === x && plan.door.y === y;
  const north = longestRun(plan.cols, (x) => !against(x, 0) && !doorAt(x, 0));
  const west = longestRun(plan.rows, (y) => !against(0, y) && !doorAt(0, y));
  if (north.length === 0 && west.length === 0) return null;
  return north.length >= west.length ? { wall: "north", ...north } : { wall: "west", ...west };
}

/**
 * Free corner cells (for plants), never the door's nor a wall or void. None once the owner decorated the floor:
 * then the scene shows their decoration only.
 */
export function freeCorners(plan: FloorPlan, tables: readonly { rect: GridRect }[], floor = 0): FloorCell[] {
  if ((plan.floors[floor]?.decor.length ?? 0) > 0) return [];
  const taken = takenCells(plan, tables, floor);
  const corners: FloorCell[] = [
    { x: 0, y: 0 },
    { x: plan.cols - 1, y: 0 },
    { x: 0, y: plan.rows - 1 },
    { x: plan.cols - 1, y: plan.rows - 1 },
  ];
  return corners.filter((cell) => !taken.has(`${cell.x},${cell.y}`));
}

/** First run of at least 3 free cells on the last row, where «SALÓN» is painted on the floor; null if none. */
export function diningLabelSpot(plan: FloorPlan, tables: readonly { rect: GridRect }[], floor = 0): FloorCell | null {
  const taken = takenCells(plan, tables, floor);
  const y = plan.rows - 1;
  let run = 0;
  for (let x = 0; x < plan.cols; x++) {
    run = taken.has(`${x},${y}`) ? 0 : run + 1;
    if (run === 3) return { x: x - 2, y };
  }
  return null;
}

/** Tallest ticket group (header + 3 tickets + «+N»), for the room reserved above the kitchen. */
export const TICKET_GROUP = { width: 112, gap: 10, header: 24, row: 38, more: 16 } as const;
export const TICKET_STACK_HEIGHT = TICKET_GROUP.header + TICKETS_PER_GROUP * TICKET_GROUP.row + TICKET_GROUP.more;

export interface SceneFrame {
  /** World size of the grid. */
  width: number;
  depth: number;
  viewBox: { x: number; y: number; width: number; height: number };
  /**
   * Scale of labels, pins and tickets: big plans are scaled down to fit, so their overlays grow to keep a
   * readable size on screen.
   */
  overlayScale: number;
  /** Bottom-center of the ticket groups over the kitchen (screen). */
  ticketsAnchor: [number, number];
}

/** The viewBox that holds the building, the street outside a front door and the tickets over the kitchen. */
export function sceneFrame(plan: FloorPlan): SceneFrame {
  const width = plan.cols * CELL;
  const depth = plan.rows * CELL;
  const points: [number, number][] = [
    project(-0.6, -0.6, WALL_HEIGHT),
    project(width + 0.6, -0.6, WALL_HEIGHT),
    project(-0.6, depth + 0.6, WALL_HEIGHT),
    project(width + 0.6, depth + 0.6, -1),
  ];
  if (plan.door) {
    const side = doorSide(plan.door, plan.cols, plan.rows);
    const cx = (plan.door.x + 0.5) * CELL;
    const cy = (plan.door.y + 0.5) * CELL;
    if (side === "east") points.push(project(width + 7, cy - 5, 0), project(width + 7, cy + 7, -1));
    if (side === "south") points.push(project(cx - 5, depth + 7, 0), project(cx + 7, depth + 7, -1));
  }
  let minX = Math.min(...points.map((p) => p[0]));
  let maxX = Math.max(...points.map((p) => p[0]));
  let minY = Math.min(...points.map((p) => p[1]));
  const maxY = Math.max(...points.map((p) => p[1]));
  const overlayScale = Math.min(2.2, Math.max(1, (maxX - minX) / 1000));

  const k = plan.kitchen;
  const anchor = project((k.x + k.w / 2) * CELL, (k.y + k.h / 2) * CELL, WALL_HEIGHT + 1);
  const ticketsAnchor: [number, number] = [anchor[0], anchor[1] - 34 * overlayScale];
  const stackWidth = (TICKET_GROUP.width * 3 + TICKET_GROUP.gap * 2) * overlayScale;
  minX = Math.min(minX, ticketsAnchor[0] - stackWidth / 2);
  maxX = Math.max(maxX, ticketsAnchor[0] + stackWidth / 2);
  minY = Math.min(minY, ticketsAnchor[1] - TICKET_STACK_HEIGHT * overlayScale);

  const pad = 20 * overlayScale;
  return {
    width,
    depth,
    viewBox: { x: r1(minX - pad), y: r1(minY - pad), width: r1(maxX - minX + pad * 2), height: r1(maxY - minY + pad * 2) },
    overlayScale,
    ticketsAnchor,
  };
}

// ── The whole view ──────────────────────────────────────────────────────────

/** Tabs of the work queue. */
export type QueueTab = "kitchen" | "pickup" | "delivery";

/** Chip color of an order status (the mock-up's chips). */
export type ChipTone = "ok" | "warn" | "pri" | "neu" | "rid";

export function statusTone(status: OrderStatus): ChipTone {
  if (status === "pending") return "warn";
  if (status === "accepted" || status === "preparing") return "pri";
  if (status === "ready") return "ok";
  if (status === "out_for_delivery") return "rid";
  return "neu";
}

export interface LiveModel {
  layout: LiveLayout;
  orders: OrderView[];
  /** Open account of each table, by table id. */
  sessionsByTable: Map<string, TableSessionView>;
  tableStates: Map<string, TableStatus>;
  /** Table id of each open account (orders point at their account, not at their table). */
  tableOfSession: Map<string, string>;
  groups: KitchenGroup[];
  readyPickups: OrderView[];
  pickupQueue: OrderView[];
  deliveryQueue: OrderView[];
  onTheWay: OrderView[];
  kitchenTarget: number;
  /** Channels the restaurant uses (for the orders card). */
  channels: OrderChannel[];
  /** Tabs of the queue: the kitchen always; pickup and deliveries while enabled or with orders still open. */
  tabs: QueueTab[];
  /** The order the tracking strip follows when nothing is selected. */
  featured: OrderView | null;
  /** The floors with their tables needing someone (the selector appears with more than one). */
  floors: FloorTab[];
}

/** Everything the live view shows, from the plan, the active orders and the open table accounts. */
export function liveModel(input: {
  view: FloorPlanView | null;
  restaurant: { pickupEnabled: boolean; deliveryEnabled: boolean; kitchenTargetMinutes: number };
  orders: readonly OrderView[];
  sessions: readonly TableSessionView[];
  now: number;
}): LiveModel {
  const { restaurant } = input;
  const layout = liveLayout(input.view, restaurant);
  const orders = [...input.orders];
  const bySession = sessionsByTable(input.sessions);
  const tableStates = new Map(layout.tables.map((table) => [table.id, tableStatus(bySession.get(table.id))]));
  const tableOfSession = new Map([...bySession.values()].map((session) => [session.id, session.tableId]));
  const hasPickup = restaurant.pickupEnabled || orders.some((o) => o.channel === "pickup");
  const hasDelivery = restaurant.deliveryEnabled || orders.some((o) => o.channel === "delivery");
  const channels: OrderChannel[] = [
    ...(layout.dining ? (["dine_in"] as const) : []),
    ...(restaurant.pickupEnabled ? (["pickup"] as const) : []),
    ...(restaurant.deliveryEnabled ? (["delivery"] as const) : []),
  ];
  return {
    layout,
    orders,
    sessionsByTable: bySession,
    tableStates,
    tableOfSession,
    groups: kitchenGroups(orders, input.now, restaurant.kitchenTargetMinutes),
    readyPickups: readyPickups(orders),
    pickupQueue: pickupQueue(orders),
    deliveryQueue: deliveryQueue(orders),
    onTheWay: onTheWay(orders),
    kitchenTarget: restaurant.kitchenTargetMinutes,
    channels,
    tabs: ["kitchen", ...(hasPickup ? (["pickup"] as const) : []), ...(hasDelivery ? (["delivery"] as const) : [])],
    featured: featuredOrder(orders, hasDelivery),
    floors: floorTabs(layout, tableStates),
  };
}
