import {
  type FloorCell,
  FLOOR_LIMITS,
  type FloorPlan,
  type FloorPlanView,
  type FloorRect,
  type FloorTableView,
  type RestaurantView,
  type SaveFloorPlanInput,
  type TableLayout,
} from "@app/types";
import { isEdgeCell, rectInGrid, rectsOverlap, tableFootprint } from "@app/utils";

/**
 * The floor plan editor (phase 9, «Mesas → Plano del local»): pure helpers over a draft that the owner edits
 * locally and saves in one PUT. Rules come from `floorPlanProblem` (@app/utils); these helpers keep the draft
 * inside the grid and refuse to drop a table on a taken cell, but let the kitchen and the pickup counter be
 * dragged over tables (the editor paints the conflict red and disables «Guardar»).
 */

/** What the editor holds: the plan and where each table stands (by table id; null = not on the plan). */
export interface FloorDraft {
  plan: FloorPlan;
  layouts: Readonly<Record<string, TableLayout | null>>;
}

/** Something drawn on the plan. */
export type FloorItem = { kind: "kitchen" } | { kind: "pickup" } | { kind: "door" } | { kind: "table"; id: string };

/** Size of a new kitchen and pickup counter (cells). */
export const DEFAULT_KITCHEN = { w: 4, h: 3 } as const;
export const DEFAULT_PICKUP = { w: 3, h: 2 } as const;
/** A table placed by the editor starts square with 4 seats. */
export const DEFAULT_TABLE: Pick<TableLayout, "shape" | "seats"> = { shape: "square", seats: 4 };

/** Stable key of an item ("kitchen", "pickup", "door", "table:<id>"), for sets and React keys. */
export function itemKey(item: FloorItem): string {
  return item.kind === "table" ? `table:${item.id}` : item.kind;
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
  }
}

/** Every item on the draft with the cells it covers (areas, door, then placed tables). */
export function draftItems(draft: FloorDraft): { item: FloorItem; rect: FloorRect }[] {
  const { plan } = draft;
  const items: { item: FloorItem; rect: FloorRect }[] = [{ item: { kind: "kitchen" }, rect: plan.kitchen }];
  if (plan.pickup) items.push({ item: { kind: "pickup" }, rect: plan.pickup });
  if (plan.door) items.push({ item: { kind: "door" }, rect: cellRect(plan.door) });
  for (const [id, layout] of Object.entries(draft.layouts)) {
    if (layout) items.push({ item: { kind: "table", id }, rect: tableFootprint(layout) });
  }
  return items;
}

/**
 * The plan a restaurant starts with: a 14 × 9 grid, a 4 × 3 kitchen in the top right corner, a 3 × 2 pickup
 * counter in the bottom right corner (only with pickup enabled), the delivery door in the middle of the bottom
 * edge (only with delivery enabled) and the active tables, square with 4 seats, in rows with one free cell
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
    layouts[table.id] = spot ? { ...spot, ...DEFAULT_TABLE } : null;
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

/** Why a cell cannot take something: outside the grid, not on the edge (door) or already taken. */
export type PlaceRefusal = "out_of_bounds" | "not_on_edge" | "taken";

export const PLACE_REFUSAL_MESSAGES: Record<PlaceRefusal, string> = {
  out_of_bounds: "No cabe ahí: queda fuera del plano",
  not_on_edge: "La puerta de delivery va en el borde del plano",
  taken: "Ese lugar está ocupado",
};

/**
 * Puts the delivery door on a cell of the edge, outside the areas and the tables.
 * @returns The new draft, or why it cannot go there.
 */
export function placeDoor(draft: FloorDraft, cell: FloorCell): FloorDraft | PlaceRefusal {
  const { cols, rows } = draft.plan;
  if (!rectInGrid(cellRect(cell), cols, rows)) return "out_of_bounds";
  if (!isEdgeCell(cell, cols, rows)) return "not_on_edge";
  const others = draftItems(draft).filter(({ item }) => item.kind !== "door");
  if (others.some(({ rect }) => rectsOverlap(rect, cellRect(cell)))) return "taken";
  return { ...draft, plan: { ...draft.plan, door: { x: cell.x, y: cell.y } } };
}

/**
 * Places (or moves, or reshapes) a table: refused when its cells fall outside the grid or touch another item.
 * @param layout Where and how; for a table already placed, pass its layout with the changes.
 * @returns The new draft, or why it cannot go there.
 */
export function placeTable(draft: FloorDraft, tableId: string, layout: TableLayout): FloorDraft | PlaceRefusal {
  const footprint = tableFootprint(layout);
  if (!rectInGrid(footprint, draft.plan.cols, draft.plan.rows)) return "out_of_bounds";
  const others = draftItems(draft).filter(({ item }) => !(item.kind === "table" && item.id === tableId));
  if (others.some(({ rect }) => rectsOverlap(rect, footprint))) return "taken";
  return { ...draft, layouts: { ...draft.layouts, [tableId]: layout } };
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
 * Changes the grid size. The door stays on its edge (on the last row/column it follows that edge). Refused
 * when the kitchen, the counter or a table would fall outside: the owner must move it first.
 * @returns The new draft, or the item that blocks the change.
 */
export function resizeGrid(draft: FloorDraft, cols: number, rows: number): FloorDraft | { blockedBy: FloorItem } {
  const { plan } = draft;
  const nextCols = clamp(cols, FLOOR_LIMITS.colsMin, FLOOR_LIMITS.colsMax);
  const nextRows = clamp(rows, FLOOR_LIMITS.rowsMin, FLOOR_LIMITS.rowsMax);
  const blocking = draftItems(draft).find(({ item, rect }) => item.kind !== "door" && !rectInGrid(rect, nextCols, nextRows));
  if (blocking) return { blockedBy: blocking.item };
  let door = plan.door;
  if (door) {
    door = {
      x: door.x === plan.cols - 1 ? nextCols - 1 : Math.min(door.x, nextCols - 1),
      y: door.y === plan.rows - 1 ? nextRows - 1 : Math.min(door.y, nextRows - 1),
    };
  }
  return { ...draft, plan: { ...plan, cols: nextCols, rows: nextRows, door } };
}

/**
 * Where the draft breaks the rules, to paint it: the cells shared by two items, plus every item involved (or
 * outside the grid, or a door off the edge). `floorPlanProblem` gives the message.
 */
export function floorConflicts(draft: FloorDraft): { cells: Set<string>; items: Set<string> } {
  const { cols, rows } = draft.plan;
  const items = draftItems(draft);
  const cells = new Set<string>();
  const involved = new Set<string>();
  items.forEach((a, i) => {
    if (!rectInGrid(a.rect, cols, rows)) involved.add(itemKey(a.item));
    if (a.item.kind === "door" && !isEdgeCell(a.rect, cols, rows)) involved.add("door");
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
 * The first cell (row by row) where a table fits without touching anything, for «Ubicar en un lugar libre»
 * (keyboard users and quick placing).
 * @returns null when the plan is full.
 */
export function firstFreeCell(draft: FloorDraft, tableId: string, layout: Pick<TableLayout, "shape" | "seats">): FloorCell | null {
  for (let y = 0; y < draft.plan.rows; y++) {
    for (let x = 0; x < draft.plan.cols; x++) {
      if (!isRefusal(placeTable(draft, tableId, { x, y, ...layout }))) return { x, y };
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
 * or added (kept inside the grid, they may cover other items), the door goes only on a free edge cell, and a
 * table (a new one square with 4 seats) is kept inside the grid and refused on taken cells.
 * @returns The resulting draft (or why not) and the cells the target would take, for the drag preview.
 */
export function dropAt(draft: FloorDraft, target: FloorTarget, cell: FloorCell): { result: FloorDraft | PlaceRefusal; rect: FloorRect } {
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
      const base = draft.layouts[target.id] ?? { x: 0, y: 0, ...DEFAULT_TABLE };
      const width = tableFootprint(base).w;
      const layout: TableLayout = { ...base, x: clamp(cell.x, 0, cols - width), y: clamp(cell.y, 0, rows - 1) };
      return { result: placeTable(draft, target.id, layout), rect: tableFootprint(layout) };
    }
  }
}

/** The item of the draft with this {@link itemKey}, or null. */
export function itemByKey(draft: FloorDraft, key: string): { item: FloorItem; rect: FloorRect } | null {
  return draftItems(draft).find(({ item }) => itemKey(item) === key) ?? null;
}
