import {
  type DecorKind,
  type FloorCell,
  FLOOR_LIMITS,
  type FloorLevel,
  type FloorMaterial,
  type FloorPlan,
  type FloorPlanView,
  type FloorRect,
  type FloorTableView,
  type RestaurantView,
  type SaveFloorPlanInput,
  type TableLayout,
  type TableRotation,
} from "@app/types";
import {
  defaultFloors,
  FIRST_FLOOR_NAME,
  isBlockedMaterial,
  isEdgeCell,
  materialAt,
  paintTerrain,
  rectCells,
  rectInGrid,
  rectsOverlap,
  resizeTerrain,
  tableFootprint,
} from "@app/utils";
import { cleanLine } from "./clean-text";

/**
 * The floor plan editor (phase 9, «Mesas → Plano del local»): pure helpers over a draft that the owner edits
 * locally and saves in one PUT. Rules come from `floorPlanProblem` (@app/utils); these helpers keep the draft
 * inside the grid and refuse to drop a table or a decoration on a taken cell, a wall or outside the building,
 * but let the kitchen and the pickup counter be dragged over anything (the editor paints the conflict red and
 * disables «Guardar»). The plan may have several floors (pisos) sharing the grid size: kitchen, pickup counter
 * and door are always on the first one; tables say their floor in `layout.floor`; each floor has its own painted
 * terrain and decorations. Helpers that work on one floor take its index (`floor`, 0 = first).
 */

/** What the editor holds: the plan and where each table stands (by table id; null = not on the plan). */
export interface FloorDraft {
  plan: FloorPlan;
  layouts: Readonly<Record<string, TableLayout | null>>;
}

/** Something drawn on the plan. A decoration is known by its index in its floor's `decor`. */
export type FloorItem =
  | { kind: "kitchen" }
  | { kind: "pickup" }
  | { kind: "door" }
  | { kind: "table"; id: string }
  | { kind: "decor"; index: number };

/** Size of a new kitchen and pickup counter (cells). */
export const DEFAULT_KITCHEN = { w: 4, h: 3 } as const;
export const DEFAULT_PICKUP = { w: 3, h: 2 } as const;
/** A table placed by the editor starts square with 4 seats, horizontal. */
export const DEFAULT_TABLE: Pick<TableLayout, "shape" | "seats" | "rotation"> = { shape: "square", seats: 4, rotation: 0 };

/** Stable key of an item ("kitchen", "pickup", "door", "table:<id>", "decor:<index>"), for sets and React keys. */
export function itemKey(item: FloorItem): string {
  if (item.kind === "table") return `table:${item.id}`;
  if (item.kind === "decor") return `decor:${item.index}`;
  return item.kind;
}

/** Stable key of a cell ("x,y"). */
export function cellKey(cell: FloorCell): string {
  return `${cell.x},${cell.y}`;
}

const cellRect = (cell: FloorCell): FloorRect => ({ x: cell.x, y: cell.y, w: 1, h: 1 });
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Spanish name of an item for messages ("la cocina", "Mesa 3"). */
export function itemName(item: FloorItem, tables: readonly Pick<FloorTableView, "id" | "label">[]): string {
  switch (item.kind) {
    case "kitchen":
      return "la cocina";
    case "pickup":
      return "el mesón de retiro";
    case "door":
      return "la puerta de delivery";
    case "table":
      return tables.find((t) => t.id === item.id)?.label ?? "una mesa";
    case "decor":
      return "la decoración";
  }
}

/**
 * Every item on one floor of the draft with the cells it covers: areas and door (first floor only), then the
 * tables placed on that floor, then its decorations.
 * @param floor Index of the floor (0 = first).
 */
export function draftItems(draft: FloorDraft, floor = 0): { item: FloorItem; rect: FloorRect }[] {
  const { plan } = draft;
  const items: { item: FloorItem; rect: FloorRect }[] = [];
  if (floor === 0) {
    items.push({ item: { kind: "kitchen" }, rect: plan.kitchen });
    if (plan.pickup) items.push({ item: { kind: "pickup" }, rect: plan.pickup });
    if (plan.door) items.push({ item: { kind: "door" }, rect: cellRect(plan.door) });
  }
  for (const [id, layout] of Object.entries(draft.layouts)) {
    if (layout && layout.floor === floor) items.push({ item: { kind: "table", id }, rect: tableFootprint(layout) });
  }
  plan.floors[floor]?.decor.forEach((decor, index) => items.push({ item: { kind: "decor", index }, rect: cellRect(decor) }));
  return items;
}

/** Whether any cell of a rectangle is a wall or outside the building on a floor. */
function onBlocked(draft: FloorDraft, floor: number, rect: FloorRect): boolean {
  const level = draft.plan.floors[floor];
  if (!level) return false;
  return rectCells(rect).some((cell) => isBlockedMaterial(materialAt(level.terrain, draft.plan.cols, cell)));
}

/** A copy of the draft with one floor changed. */
function withFloor(draft: FloorDraft, floor: number, change: (level: FloorLevel) => FloorLevel): FloorDraft {
  return { ...draft, plan: { ...draft.plan, floors: draft.plan.floors.map((level, i) => (i === floor ? change(level) : level)) } };
}

/**
 * The plan a restaurant starts with: a 14 × 9 grid, a 4 × 3 kitchen in the top right corner, a 3 × 2 pickup
 * counter in the bottom right corner (only with pickup enabled), the delivery door in the middle of the bottom
 * edge (only with delivery enabled) and the active tables, square with 4 seats and horizontal, in rows with one free cell
 * between them and around the areas. Tables that do not fit stay unplaced; the result is always valid for
 * `floorPlanProblem`.
 * @param tables Every table of the restaurant; inactive ones are left unplaced.
 */
export function defaultFloorPlan(
  restaurant: Pick<RestaurantView, "pickupEnabled" | "deliveryEnabled">,
  tables: readonly Pick<FloorTableView, "id" | "active">[],
): FloorDraft {
  const cols = FLOOR_LIMITS.colsDefault;
  const rows = FLOOR_LIMITS.rowsDefault;
  const plan: FloorPlan = {
    cols,
    rows,
    kitchen: { x: cols - DEFAULT_KITCHEN.w, y: 0, ...DEFAULT_KITCHEN },
    pickup: restaurant.pickupEnabled ? { x: cols - DEFAULT_PICKUP.w, y: rows - DEFAULT_PICKUP.h, ...DEFAULT_PICKUP } : null,
    door: restaurant.deliveryEnabled ? { x: Math.floor(cols / 2), y: rows - 1 } : null,
    floors: defaultFloors(),
  };
  // Keep one free cell around the areas and the door, so the default plan looks walkable.
  const grow = (rect: FloorRect): FloorRect => ({ x: rect.x - 1, y: rect.y - 1, w: rect.w + 2, h: rect.h + 2 });
  const blocked = [plan.kitchen, ...(plan.pickup ? [plan.pickup] : []), ...(plan.door ? [cellRect(plan.door)] : [])].map(grow);
  const spots: FloorCell[] = [];
  for (let y = 1; y < rows - 1; y += 2) {
    for (let x = 1; x < cols - 1; x += 2) {
      if (!blocked.some((rect) => rectsOverlap(rect, cellRect({ x, y })))) spots.push({ x, y });
    }
  }
  const layouts: Record<string, TableLayout | null> = {};
  let next = 0;
  for (const table of tables) {
    const spot = table.active ? spots[next] : undefined;
    if (spot) next += 1;
    layouts[table.id] = spot ? { ...spot, ...DEFAULT_TABLE, floor: 0 } : null;
  }
  return { plan, layouts };
}

/** The draft of a saved plan (null when there is none yet). */
export function draftFromView(view: FloorPlanView): FloorDraft | null {
  if (!view.plan) return null;
  return { plan: view.plan, layouts: Object.fromEntries(view.tables.map((t) => [t.id, t.layout])) };
}

/**
 * The PUT body: every table of the restaurant, the unplaced ones with `layout: null` (the api takes tables
 * left out off the plan anyway; listing them all makes the intent explicit).
 * @param draft null deletes the plan.
 */
export function saveInput(draft: FloorDraft | null, tables: readonly Pick<FloorTableView, "id">[]): SaveFloorPlanInput {
  return {
    plan: draft ? draft.plan : null,
    tables: tables.map((t) => ({ tableId: t.id, layout: draft ? (draft.layouts[t.id] ?? null) : null })),
  };
}

/** Whether two drafts describe the same plan (for "cambios sin guardar"). */
export function sameDraft(a: FloorDraft | null, b: FloorDraft | null, tables: readonly Pick<FloorTableView, "id">[]): boolean {
  return JSON.stringify(saveInput(a, tables)) === JSON.stringify(saveInput(b, tables));
}

/** Moves a rectangle so its top-left corner is at `x, y`, kept inside the grid. */
export function moveRect(rect: FloorRect, x: number, y: number, cols: number, rows: number): FloorRect {
  return { ...rect, x: clamp(x, 0, Math.max(0, cols - rect.w)), y: clamp(y, 0, Math.max(0, rows - rect.h)) };
}

/**
 * Resizes an area to `w × h`, at least FLOOR_LIMITS.areaMin and at most the grid. It grows to the right and
 * down, and slides back when it reaches the edge, so «+» always works while there is room.
 */
export function resizeRect(rect: FloorRect, w: number, h: number, cols: number, rows: number): FloorRect {
  const width = clamp(w, FLOOR_LIMITS.areaMin, cols);
  const height = clamp(h, FLOOR_LIMITS.areaMin, rows);
  return { x: clamp(rect.x, 0, cols - width), y: clamp(rect.y, 0, rows - height), w: width, h: height };
}

/** Moves the kitchen or the pickup counter (top-left corner at `x, y`, kept inside the grid). */
export function moveArea(draft: FloorDraft, area: "kitchen" | "pickup", x: number, y: number): FloorDraft {
  const rect = draft.plan[area];
  if (!rect) return draft;
  return { ...draft, plan: { ...draft.plan, [area]: moveRect(rect, x, y, draft.plan.cols, draft.plan.rows) } };
}

/** Changes the size of the kitchen or the pickup counter (see {@link resizeRect}). */
export function resizeArea(draft: FloorDraft, area: "kitchen" | "pickup", w: number, h: number): FloorDraft {
  const rect = draft.plan[area];
  if (!rect) return draft;
  return { ...draft, plan: { ...draft.plan, [area]: resizeRect(rect, w, h, draft.plan.cols, draft.plan.rows) } };
}

/** Adds the pickup counter (3 × 2) with its corner at `x, y`, or moves it there when it already exists. */
export function placePickup(draft: FloorDraft, x: number, y: number): FloorDraft {
  const { cols, rows } = draft.plan;
  const rect = draft.plan.pickup ?? resizeRect({ x, y, ...DEFAULT_PICKUP }, DEFAULT_PICKUP.w, DEFAULT_PICKUP.h, cols, rows);
  return { ...draft, plan: { ...draft.plan, pickup: moveRect(rect, x, y, cols, rows) } };
}

/** Takes the pickup counter or the door off the plan. */
export function removeFromPlan(draft: FloorDraft, part: "pickup" | "door"): FloorDraft {
  return { ...draft, plan: { ...draft.plan, [part]: null } };
}

/** Every cell on the first/last row or column, where the delivery door may go. */
export function edgeCells(cols: number, rows: number): FloorCell[] {
  const cells: FloorCell[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (isEdgeCell({ x, y }, cols, rows)) cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Why a cell cannot take something: outside the grid, not on the edge (door), already taken, a wall or outside
 * the building (`blocked`), or the floor already has FLOOR_LIMITS.decorMax decorations (`full`).
 */
export type PlaceRefusal = "out_of_bounds" | "not_on_edge" | "taken" | "blocked" | "full";

export const PLACE_REFUSAL_MESSAGES: Record<PlaceRefusal, string> = {
  out_of_bounds: "No cabe ahí: queda fuera del plano",
  not_on_edge: "La puerta de delivery va en el borde del plano",
  taken: "Ese lugar está ocupado",
  blocked: "Ahí hay un muro o queda fuera del local",
  full: `Este piso ya tiene ${FLOOR_LIMITS.decorMax} decoraciones`,
};

/**
 * Puts the delivery door on a cell of the edge (first floor), outside the areas, the tables and the decorations.
 * It may open a wall, never a cell outside the building.
 * @returns The new draft, or why it cannot go there.
 */
export function placeDoor(draft: FloorDraft, cell: FloorCell): FloorDraft | PlaceRefusal {
  const { cols, rows } = draft.plan;
  if (!rectInGrid(cellRect(cell), cols, rows)) return "out_of_bounds";
  if (!isEdgeCell(cell, cols, rows)) return "not_on_edge";
  const others = draftItems(draft, 0).filter(({ item }) => item.kind !== "door");
  if (others.some(({ rect }) => rectsOverlap(rect, cellRect(cell)))) return "taken";
  if (cellMaterial(draft, 0, cell) === "void") return "blocked";
  return { ...draft, plan: { ...draft.plan, door: { x: cell.x, y: cell.y } } };
}

/**
 * Places (or moves, or reshapes) a table on its floor (`layout.floor`): refused when its cells fall outside the
 * grid, on a wall or outside the building, or touch another item of that floor (decorations included).
 * @param layout Where and how; for a table already placed, pass its layout with the changes.
 * @returns The new draft, or why it cannot go there.
 */
export function placeTable(draft: FloorDraft, tableId: string, layout: TableLayout): FloorDraft | PlaceRefusal {
  const footprint = tableFootprint(layout);
  if (!rectInGrid(footprint, draft.plan.cols, draft.plan.rows) || !draft.plan.floors[layout.floor]) return "out_of_bounds";
  const others = draftItems(draft, layout.floor).filter(({ item }) => !(item.kind === "table" && item.id === tableId));
  if (others.some(({ rect }) => rectsOverlap(rect, footprint))) return "taken";
  if (onBlocked(draft, layout.floor, footprint)) return "blocked";
  return { ...draft, layouts: { ...draft.layouts, [tableId]: layout } };
}

/** The other orientation: horizontal (0) ↔ vertical (90). */
export function nextRotation(rotation: TableRotation): TableRotation {
  return rotation === 90 ? 0 : 90;
}

/** Messages when a table cannot be turned where it stands (its long side would not fit). */
export const ROTATE_REFUSAL_MESSAGES: Record<Exclude<PlaceRefusal, "not_on_edge" | "full">, string> = {
  out_of_bounds: "No cabe girada: queda fuera del plano",
  taken: "No cabe girada: hay algo al lado",
  blocked: "No cabe girada: hay un muro al lado",
};

/**
 * Turns a placed table a quarter (horizontal ↔ vertical) on its top-left cell. Tables of 6–8 seats change
 * their footprint (2 × 1 ↔ 1 × 2), so the turn is refused when the new cells fall outside or are taken; tables
 * of 2–4 seats keep their cell and only turn the chairs.
 * @returns The new draft (unchanged for a table that is not on the plan), or why it cannot turn.
 */
export function rotateTable(draft: FloorDraft, tableId: string): FloorDraft | PlaceRefusal {
  const layout = draft.layouts[tableId];
  if (!layout) return draft;
  return placeTable(draft, tableId, { ...layout, rotation: nextRotation(layout.rotation) });
}

/**
 * How the editor draws the chairs of a table: along its long sides, half on each. Horizontal tables have them
 * above and below, vertical ones (rotation 90) on the left and right. A round table of 2–4 seats looks the same
 * either way, so its rotation is ignored (it is still saved).
 * @returns The sides holding chairs and how many go on each.
 */
export function tableChairs(layout: Pick<TableLayout, "shape" | "seats" | "rotation">): {
  sides: "top-bottom" | "left-right";
  perSide: number;
} {
  const turned = layout.rotation === 90 && (layout.shape === "square" || layout.seats >= 6);
  return { sides: turned ? "left-right" : "top-bottom", perSide: Math.ceil(layout.seats / 2) };
}

/** Takes a table off the plan (it goes back to «Sin ubicar»). */
export function removeTable(draft: FloorDraft, tableId: string): FloorDraft {
  return { ...draft, layouts: { ...draft.layouts, [tableId]: null } };
}

/** Whether a placement helper refused. */
export function isRefusal(result: FloorDraft | PlaceRefusal): result is PlaceRefusal {
  return typeof result === "string";
}

/**
 * Changes the grid size of every floor. The door stays on its edge (on the last row/column it follows that
 * edge); painted terrain keeps its cells from the top-left corner (new cells are plain floor) and decorations
 * left outside are dropped. Refused when the kitchen, the counter or a table (of any floor) would fall outside:
 * the owner must move it first.
 * @returns The new draft, or the item that blocks the change and its floor.
 */
export function resizeGrid(
  draft: FloorDraft,
  cols: number,
  rows: number,
): FloorDraft | { blockedBy: FloorItem; floor: number } {
  const { plan } = draft;
  const nextCols = clamp(cols, FLOOR_LIMITS.colsMin, FLOOR_LIMITS.colsMax);
  const nextRows = clamp(rows, FLOOR_LIMITS.rowsMin, FLOOR_LIMITS.rowsMax);
  for (let floor = 0; floor < plan.floors.length; floor++) {
    const blocking = draftItems(draft, floor).find(
      ({ item, rect }) => item.kind !== "door" && item.kind !== "decor" && !rectInGrid(rect, nextCols, nextRows),
    );
    if (blocking) return { blockedBy: blocking.item, floor };
  }
  const floors = plan.floors.map((level) => ({
    ...level,
    terrain: resizeTerrain(level.terrain, plan.cols, nextCols, nextRows),
    decor: level.decor.filter((decor) => rectInGrid(cellRect(decor), nextCols, nextRows)),
  }));
  let door = plan.door;
  if (door) {
    door = {
      x: door.x === plan.cols - 1 ? nextCols - 1 : Math.min(door.x, nextCols - 1),
      y: door.y === plan.rows - 1 ? nextRows - 1 : Math.min(door.y, nextRows - 1),
    };
  }
  return { ...draft, plan: { ...plan, cols: nextCols, rows: nextRows, door, floors } };
}

/**
 * Where one floor of the draft breaks the rules, to paint it: the cells shared by two items or by an item and a
 * wall / the outside (only the outside for the door, which may open a wall), plus every item involved (or
 * outside the grid, or a door off the edge). `floorPlanProblem` gives the message.
 * @param floor Index of the floor (0 = first).
 */
export function floorConflicts(draft: FloorDraft, floor = 0): { cells: Set<string>; items: Set<string> } {
  const { cols, rows } = draft.plan;
  const items = draftItems(draft, floor);
  const cells = new Set<string>();
  const involved = new Set<string>();
  items.forEach((a, i) => {
    if (!rectInGrid(a.rect, cols, rows)) involved.add(itemKey(a.item));
    if (a.item.kind === "door" && !isEdgeCell(a.rect, cols, rows)) involved.add("door");
    for (const cell of rectCells(a.rect)) {
      const material = cellMaterial(draft, floor, cell);
      if (a.item.kind === "door" ? material !== "void" : !isBlockedMaterial(material)) continue;
      involved.add(itemKey(a.item));
      cells.add(cellKey(cell));
    }
    for (const b of items.slice(i + 1)) {
      if (!rectsOverlap(a.rect, b.rect)) continue;
      involved.add(itemKey(a.item));
      involved.add(itemKey(b.item));
      for (let y = Math.max(a.rect.y, b.rect.y); y < Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h); y++) {
        for (let x = Math.max(a.rect.x, b.rect.x); x < Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w); x++) {
          cells.add(cellKey({ x, y }));
        }
      }
    }
  });
  return { cells, items: involved };
}

/**
 * Notices about zones that the live view will or will not draw: the counter and the door are shown only
 * while pickup / delivery are enabled.
 */
export function serviceWarnings(
  restaurant: Pick<RestaurantView, "pickupEnabled" | "deliveryEnabled">,
  plan: Pick<FloorPlan, "pickup" | "door">,
): string[] {
  const warnings: string[] = [];
  if (restaurant.pickupEnabled && !plan.pickup) {
    warnings.push("Tienes activo el retiro en el local, pero el plano no tiene mesón de retiro: la vista En vivo no mostrará dónde esperan los pedidos listos.");
  }
  if (!restaurant.pickupEnabled && plan.pickup) {
    warnings.push("El retiro en el local está desactivado: la vista En vivo no dibujará el mesón de retiro hasta que lo actives.");
  }
  if (restaurant.deliveryEnabled && !plan.door) {
    warnings.push("Tienes activo el delivery, pero el plano no tiene puerta de delivery: la vista En vivo no mostrará la salida de los repartidores.");
  }
  if (!restaurant.deliveryEnabled && plan.door) {
    warnings.push("El delivery está desactivado: la vista En vivo no dibujará la puerta de delivery hasta que lo actives.");
  }
  return warnings;
}

/** Active tables not on the plan, in the api's order (the «Sin ubicar» list). */
export function unplacedTables<T extends Pick<FloorTableView, "id" | "active">>(draft: FloorDraft, tables: readonly T[]): T[] {
  return tables.filter((t) => t.active && !draft.layouts[t.id]);
}

/**
 * The first cell (row by row) of a floor where a table fits without touching anything, for «Ubicar en un lugar
 * libre» (keyboard users and quick placing).
 * @param floor Index of the floor (0 = first).
 * @returns null when the floor is full.
 */
export function firstFreeCell(
  draft: FloorDraft,
  tableId: string,
  layout: Pick<TableLayout, "shape" | "seats" | "rotation">,
  floor = 0,
): FloorCell | null {
  for (let y = 0; y < draft.plan.rows; y++) {
    for (let x = 0; x < draft.plan.cols; x++) {
      if (!isRefusal(placeTable(draft, tableId, { x, y, ...layout, floor }))) return { x, y };
    }
  }
  return null;
}

/**
 * Keeps the local edits after the table list changed on the server (a table deleted or created meanwhile):
 * deleted tables leave the draft, new ones start unplaced.
 */
export function withTables(draft: FloorDraft, tables: readonly Pick<FloorTableView, "id">[]): FloorDraft {
  return { plan: draft.plan, layouts: Object.fromEntries(tables.map((t) => [t.id, draft.layouts[t.id] ?? null])) };
}

/** "Mesa 12" → "12", "Terraza 3" → "T3": table chips on the grid are small (the full name is in the label). */
export function shortTableLabel(label: string): string {
  const mesa = /^mesa\s+(.+)$/i.exec(label);
  if (mesa?.[1]) return mesa[1];
  const word = /^(\p{L})\p{L}*\s+(\d.*)$/u.exec(label);
  if (word?.[1] && word[2]) return `${word[1].toUpperCase()}${word[2]}`;
  return label;
}

/** Something the owner can put on a cell: an item of the plan, or a table from the «Sin ubicar» list. */
export type FloorTarget = FloorItem | { kind: "new-table"; id: string };

/**
 * Puts a target with its top-left corner on a cell (a tap with a tool, a drop, «Mover» + tap): areas are moved
 * or added (kept inside the grid, they may cover other items), the door goes only on a free edge cell, a table
 * (a new one square with 4 seats, on `floor`) is kept inside the grid and refused on taken or blocked cells, and
 * a decoration of `floor` moves only to a free cell.
 * @param floor The floor shown: where a new table goes and whose decorations are meant.
 * @returns The resulting draft (or why not) and the cells the target would take, for the drag preview.
 */
export function dropAt(
  draft: FloorDraft,
  target: FloorTarget,
  cell: FloorCell,
  floor = 0,
): { result: FloorDraft | PlaceRefusal; rect: FloorRect } {
  const { cols, rows } = draft.plan;
  switch (target.kind) {
    case "kitchen":
    case "pickup": {
      const next = target.kind === "pickup" && !draft.plan.pickup ? placePickup(draft, cell.x, cell.y) : moveArea(draft, target.kind, cell.x, cell.y);
      return { result: next, rect: next.plan[target.kind] ?? cellRect(cell) };
    }
    case "door":
      return { result: placeDoor(draft, cell), rect: cellRect(cell) };
    case "table":
    case "new-table": {
      // A dragged table keeps its orientation, so a vertical one stays vertical (and inside the grid).
      const base = draft.layouts[target.id] ?? { x: 0, y: 0, ...DEFAULT_TABLE, floor };
      const { w, h } = tableFootprint(base);
      const layout: TableLayout = { ...base, x: clamp(cell.x, 0, cols - w), y: clamp(cell.y, 0, rows - h) };
      return { result: placeTable(draft, target.id, layout), rect: tableFootprint(layout) };
    }
    case "decor":
      return { result: moveDecor(draft, floor, target.index, cell), rect: cellRect(cell) };
  }
}

/**
 * The item of one floor of the draft with this {@link itemKey}, or null.
 * @param floor Index of the floor (0 = first).
 */
export function itemByKey(draft: FloorDraft, key: string, floor = 0): { item: FloorItem; rect: FloorRect } | null {
  return draftItems(draft, floor).find(({ item }) => itemKey(item) === key) ?? null;
}

// ── Floors ──────────────────────────────────────────────────────────────────

/** Names offered to new floors, in order; the first one not in use is taken. */
const FLOOR_NAMES = [FIRST_FLOOR_NAME, "Segundo piso", "Tercer piso", "Cuarto piso"] as const;

/**
 * Adds an empty floor (plain terrain, no decorations) at the end, named after the first of "Segundo piso",
 * "Tercer piso", "Cuarto piso" not in use (a floor may have been deleted or renamed).
 * @returns The new draft, or null when the plan already has FLOOR_LIMITS.floorsMax floors.
 */
export function addFloor(draft: FloorDraft): FloorDraft | null {
  const { floors } = draft.plan;
  if (floors.length >= FLOOR_LIMITS.floorsMax) return null;
  const used = new Set(floors.map((level) => level.name.toLowerCase()));
  const name = FLOOR_NAMES.slice(1).find((n) => !used.has(n.toLowerCase())) ?? `Piso ${floors.length + 1}`;
  return { ...draft, plan: { ...draft.plan, floors: [...floors, { name, terrain: null, decor: [] }] } };
}

/** Why a floor name is not accepted. */
export type FloorNameProblem = "empty" | "too_long";

export const FLOOR_NAME_MESSAGES: Record<FloorNameProblem, string> = {
  empty: "Escribe un nombre para el piso",
  too_long: `El nombre del piso puede tener hasta ${FLOOR_LIMITS.floorNameMax} caracteres`,
};

/**
 * Renames a floor with the text as typed, cleaned like the api does (one space between words, no invisible
 * characters).
 * @returns The new draft, or why the name is not accepted.
 */
export function renameFloor(draft: FloorDraft, floor: number, name: string): FloorDraft | FloorNameProblem {
  const clean = cleanLine(name);
  if (clean.length === 0) return "empty";
  if (clean.length > FLOOR_LIMITS.floorNameMax) return "too_long";
  return withFloor(draft, floor, (level) => ({ ...level, name: clean }));
}

/** Ids of the tables placed on a floor. */
export function tablesOnFloor(draft: FloorDraft, floor: number): string[] {
  return Object.entries(draft.layouts).flatMap(([id, layout]) => (layout?.floor === floor ? [id] : []));
}

/**
 * Deletes a floor other than the first (which holds the kitchen): its tables go back to «Sin ubicar» and the
 * tables of the floors above move down one index, so they stay on the same floor.
 * @returns The new draft (unchanged for the first floor or one that does not exist).
 */
export function removeFloor(draft: FloorDraft, floor: number): FloorDraft {
  if (floor <= 0 || floor >= draft.plan.floors.length) return draft;
  const layouts = Object.fromEntries(
    Object.entries(draft.layouts).map(([id, layout]): [string, TableLayout | null] => {
      if (!layout || layout.floor < floor) return [id, layout];
      return [id, layout.floor === floor ? null : { ...layout, floor: layout.floor - 1 }];
    }),
  );
  return { plan: { ...draft.plan, floors: draft.plan.floors.filter((_, i) => i !== floor) }, layouts };
}

// ── Terrain ─────────────────────────────────────────────────────────────────

/** The material of a cell of a floor ("floor" for a floor that does not exist). */
export function cellMaterial(draft: FloorDraft, floor: number, cell: FloorCell): FloorMaterial {
  return materialAt(draft.plan.floors[floor]?.terrain ?? null, draft.plan.cols, cell);
}

/**
 * Paints cells of a floor. Walls and the outside (void) keep tables, areas and decorations out, so those
 * materials skip the cells such an item takes (the door may open a wall, so only void skips it); any other
 * material paints under everything.
 * @returns The new draft (the same object when nothing changed) and how many cells were skipped.
 */
export function paintCells(
  draft: FloorDraft,
  floor: number,
  cells: readonly FloorCell[],
  material: FloorMaterial,
): { draft: FloorDraft; refused: number } {
  const level = draft.plan.floors[floor];
  if (!level) return { draft, refused: 0 };
  const { cols, rows } = draft.plan;
  const inGrid = cells.filter((cell) => rectInGrid(cellRect(cell), cols, rows));
  let allowed = inGrid;
  if (isBlockedMaterial(material)) {
    const taken = new Set<string>();
    for (const { item, rect } of draftItems(draft, floor)) {
      if (item.kind === "door" && material !== "void") continue;
      for (const cell of rectCells(rect)) taken.add(cellKey(cell));
    }
    allowed = inGrid.filter((cell) => !taken.has(cellKey(cell)));
  }
  const refused = new Set(inGrid.map(cellKey)).size - new Set(allowed.map(cellKey)).size;
  const terrain = paintTerrain(level.terrain, cols, rows, allowed, material);
  if (terrain === level.terrain) return { draft, refused };
  return { draft: withFloor(draft, floor, (current) => ({ ...current, terrain })), refused };
}

/**
 * The cells a straight line crosses from one cell to another, both included (Bresenham): a quick drag reports
 * cells far apart, and painting only those would leave gaps.
 */
export function lineCells(from: FloorCell, to: FloorCell): FloorCell[] {
  const cells: FloorCell[] = [];
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let { x, y } = from;
  let error = dx + dy;
  for (;;) {
    cells.push({ x, y });
    if (x === to.x && y === to.y) return cells;
    const double = 2 * error;
    if (double >= dy) {
      error += dy;
      x += sx;
    }
    if (double <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/** The rectangle between two cells (any two opposite corners), for «Rellenar». */
export function rectBetween(a: FloorCell, b: FloorCell): FloorRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

// ── Decorations ─────────────────────────────────────────────────────────────

/** Why a decoration cannot stand on a cell of a floor (`ignore`: the index of the one being moved). */
function decorRefusal(draft: FloorDraft, floor: number, cell: FloorCell, ignore: number | null): PlaceRefusal | null {
  if (!rectInGrid(cellRect(cell), draft.plan.cols, draft.plan.rows)) return "out_of_bounds";
  const others = draftItems(draft, floor).filter(({ item }) => !(item.kind === "decor" && item.index === ignore));
  if (others.some(({ rect }) => rectsOverlap(rect, cellRect(cell)))) return "taken";
  if (isBlockedMaterial(cellMaterial(draft, floor, cell))) return "blocked";
  return null;
}

/**
 * Places a decoration on a free cell of a floor (not a wall nor outside the building).
 * @returns The new draft (the decoration is the last of the floor's `decor`), or why not.
 */
export function placeDecor(draft: FloorDraft, floor: number, kind: DecorKind, cell: FloorCell): FloorDraft | PlaceRefusal {
  const level = draft.plan.floors[floor];
  if (!level) return "out_of_bounds";
  if (level.decor.length >= FLOOR_LIMITS.decorMax) return "full";
  const refusal = decorRefusal(draft, floor, cell, null);
  if (refusal) return refusal;
  return withFloor(draft, floor, (current) => ({ ...current, decor: [...current.decor, { kind, x: cell.x, y: cell.y }] }));
}

/**
 * Moves a decoration of a floor to another free cell (its own cell counts as free).
 * @returns The new draft (unchanged for an unknown index), or why not.
 */
export function moveDecor(draft: FloorDraft, floor: number, index: number, cell: FloorCell): FloorDraft | PlaceRefusal {
  if (!draft.plan.floors[floor]?.decor[index]) return draft;
  const refusal = decorRefusal(draft, floor, cell, index);
  if (refusal) return refusal;
  return withFloor(draft, floor, (level) => ({
    ...level,
    decor: level.decor.map((item, i) => (i === index ? { ...item, x: cell.x, y: cell.y } : item)),
  }));
}

/** Takes a decoration off a floor (the ones after it move down one index). */
export function removeDecor(draft: FloorDraft, floor: number, index: number): FloorDraft {
  return withFloor(draft, floor, (level) => ({ ...level, decor: level.decor.filter((_, i) => i !== index) }));
}

/**
 * The first cell (row by row) of a floor where a decoration fits, for «Poner en un lugar libre» (keyboard users).
 * @returns null when no cell is free.
 */
export function firstFreeDecorCell(draft: FloorDraft, floor: number): FloorCell | null {
  for (let y = 0; y < draft.plan.rows; y++) {
    for (let x = 0; x < draft.plan.cols; x++) {
      if (!decorRefusal(draft, floor, { x, y }, null)) return { x, y };
    }
  }
  return null;
}
