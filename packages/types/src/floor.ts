// ── Live floor (phase 9) ────────────────────────────────────────────────────
//
// The restaurant drawn on an isometric grid for the owner and the cashier: the dining room with its tables
// colored by their account, the kitchen with its tickets, the pickup counter and the delivery door. Each zone
// is drawn only when the restaurant uses it: no positioned tables → no dining room, `pickupEnabled` off →
// no counter, `deliveryEnabled` off → no door nor riders map. The kitchen is always drawn.

import type { OrderChannel } from "./orders";

/** Bounds of the floor plan grid (cells). */
export const FLOOR_LIMITS = {
  colsMin: 6,
  colsMax: 24,
  rowsMin: 4,
  rowsMax: 16,
  /** Suggested size of a new plan. */
  colsDefault: 14,
  rowsDefault: 9,
  /** Kitchen and pickup areas are at least this many cells wide and deep. */
  areaMin: 2,
  /** Entries a save may list (a 24 × 16 grid has 384 cells; inactive or unplaced tables may be listed too). */
  tablesMax: 500,
  /** Floors (levels) of a plan: the first one holds the kitchen, the pickup counter and the door. */
  floorsMax: 4,
  /** Characters of a floor's name. */
  floorNameMax: 30,
  /** Decorations per floor. */
  decorMax: 150,
} as const;

/** Minutes the owner expects an order to take from accepted to ready (the kitchen gauge). */
export const KITCHEN_TARGET_LIMITS = { minutesDefault: 20, minutesMin: 5, minutesMax: 90 } as const;

/** A rectangle of whole cells: top-left corner (x = column, y = row, from 0) and size. */
export interface FloorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One cell of the grid. */
export interface FloorCell {
  x: number;
  y: number;
}

/**
 * What a cell of a floor is made of, painted by the owner: the code is the character stored for the cell in
 * `FloorLevel.terrain`. `floor` is the plain floor (every cell of plans saved before painting existed). `wall`
 * and `void` (outside the building: L-shaped places, patios) cannot hold tables, areas or decorations; the
 * delivery door may sit on a wall (it opens it), never on a void.
 */
export const FLOOR_MATERIALS = {
  floor: ".",
  wood: "w",
  tile: "t",
  carpet: "c",
  stone: "s",
  grass: "g",
  wall: "#",
  void: "_",
} as const;
export type FloorMaterial = keyof typeof FLOOR_MATERIALS;

/** Purely decorative items (no effect on orders): each takes one cell. */
export const DECOR_KINDS = ["plant", "tree", "planter", "flowers", "lamp", "umbrella", "bench"] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

export interface FloorDecor {
  kind: DecorKind;
  x: number;
  y: number;
}

/**
 * One floor (level) of the restaurant. Every floor shares the plan's grid size; tables say which floor they
 * are on (`TableLayout.floor`, the index in `FloorPlan.floors`).
 */
export interface FloorLevel {
  /** Shown in the floor selector ("Primer piso", "Terraza"). */
  name: string;
  /**
   * One FLOOR_MATERIALS code per cell, row by row (`cols × rows` characters). null = every cell plain floor.
   */
  terrain: string | null;
  decor: FloorDecor[];
}

/** Owner-drawn layout of the restaurant. */
export interface FloorPlan {
  cols: number;
  rows: number;
  /** Mandatory: every restaurant has a kitchen. */
  kitchen: FloorRect;
  /** The pickup counter; drawn only while `pickupEnabled`. */
  pickup: FloorRect | null;
  /** Where riders leave, on an edge of the grid; drawn only while `deliveryEnabled`. */
  door: FloorCell | null;
  /**
   * At least one. Kitchen, pickup counter and door are on the first one. Plans saved before floors existed
   * read as one floor of plain cells without decorations.
   */
  floors: FloorLevel[];
}

/** A plan as clients send it: `floors` may be omitted (= one plain floor), so older clients keep working. */
export type FloorPlanInput = Omit<FloorPlan, "floors"> & { floors?: FloorLevel[] };

export const TABLE_SHAPES = ["round", "square"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

export const TABLE_SEATS = [2, 4, 6, 8] as const;
export type TableSeats = (typeof TABLE_SEATS)[number];

/**
 * Orientation of a table on the plan, in degrees: 0 = horizontal, 90 = vertical (turned a quarter). It changes
 * the footprint of tables of 6–8 seats (2 × 1 → 1 × 2); on tables of 2–4 seats it only turns the chairs.
 */
export const TABLE_ROTATIONS = [0, 90] as const;
export type TableRotation = (typeof TABLE_ROTATIONS)[number];

/**
 * Where a table sits on the plan. `x, y` is its top-left cell; tables of 2–4 seats take 1 cell, of 6–8
 * seats 2 × 1 (horizontal, `rotation` 0) or 1 × 2 (vertical, `rotation` 90): see `tableFootprint` in @app/utils.
 */
export interface TableLayout {
  x: number;
  y: number;
  shape: TableShape;
  seats: TableSeats;
  /** Always present in views (documents saved before it existed read as 0). */
  rotation: TableRotation;
  /** Index of its floor in `FloorPlan.floors`; always present in views (older documents read as 0). */
  floor: number;
}

/** A table layout as clients send it: `rotation` and `floor` may be omitted (= 0), so older clients keep working. */
export type TableLayoutInput = Omit<TableLayout, "rotation" | "floor"> & { rotation?: TableRotation; floor?: number };

/** A table as the floor plan editor and the live view see it. */
export interface FloorTableView {
  id: string;
  label: string;
  /** Inactive tables are never drawn (the view filters them out), even if they keep a layout. */
  active: boolean;
  /** null = not placed on the plan (the editor lists it to be placed). */
  layout: TableLayout | null;
}

/** `GET /api/restaurants/:id/floor-plan` and the `floor-plan.updated` event. */
export interface FloorPlanView {
  /** null = the owner has not drawn the restaurant yet. */
  plan: FloorPlan | null;
  /** Every table of the restaurant, in natural label order, placed or not. */
  tables: FloorTableView[];
}

/**
 * Body of `PUT /api/restaurants/:id/floor-plan` (owner). It replaces the whole layout: tables not listed (or
 * listed with null) are taken off the plan. `plan: null` deletes the plan and every table layout.
 */
export interface SaveFloorPlanInput {
  plan: FloorPlanInput | null;
  tables: { tableId: string; layout: TableLayoutInput | null }[];
}

/** `GET /api/restaurants/:id/live` (owner, cashier): the indicators on top of the live view. */
export interface LiveSummary {
  /** When it was computed (ISO). */
  at: string;
  sales: {
    /** Today's sales so far (orders not rejected or cancelled), minor units. */
    total: number;
    currency: string;
    /**
     * Against the same weekday of last week up to the same local time, rounded to a whole percent; null when
     * there were no sales then.
     */
    changePercent: number | null;
  };
  /** Today's sales per local hour, from 0 to the current hour (hours without sales included with 0). */
  hourly: { hour: number; total: number }[];
  /** Orders not final yet, per channel (orders of earlier days still open included). */
  inProgress: Record<OrderChannel, number> & { total: number };
  kitchen: {
    /**
     * Today's average from accepted (or from pending when never accepted) to ready, of the orders that
     * reached ready; whole minutes, null without any.
     */
    averageMinutes: number | null;
    /** The owner's goal (`kitchenTargetMinutes`). */
    targetMinutes: number;
    /** Orders in the average. */
    sample: number;
  };
  tables: {
    /** Active tables placed on the plan (0 without a plan). */
    positioned: number;
    /** Open accounts with at least one order or a call to the waiter. */
    occupied: number;
    callingWaiter: number;
    billRequested: number;
    /** Open accounts with partial payments registered. */
    payingInParts: number;
  };
}
