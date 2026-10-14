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
}

export const TABLE_SHAPES = ["round", "square"] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];

export const TABLE_SEATS = [2, 4, 6, 8] as const;
export type TableSeats = (typeof TABLE_SEATS)[number];

/**
 * Where a table sits on the plan. `x, y` is its top-left cell; tables of 2–4 seats take 1 cell, of 6–8
 * seats 2 × 1 (horizontal): see `tableFootprint` in @app/utils.
 */
export interface TableLayout {
  x: number;
  y: number;
  shape: TableShape;
  seats: TableSeats;
}

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
  plan: FloorPlan | null;
  tables: { tableId: string; layout: TableLayout | null }[];
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
