"use client";

import type { FloorCell, FloorRect, FloorTableView, TableLayout } from "@app/types";
import { isEdgeCell, materialAt, tableFootprint } from "@app/utils";
import { ChefHatIcon, DoorOpenIcon, ShoppingBagIcon } from "lucide-react";
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode, RefObject } from "react";
import { cellKey, type FloorDraft, type FloorItem, itemKey, shortTableLabel, tableChairs } from "@/lib/floor-editor";
import { DECOR_LABELS } from "@/lib/floor-materials";
import { cn } from "@/lib/utils";
import { DecorIcon, materialStyle } from "./floor-terrain";

/** Smallest and largest cell on screen (px): phones scroll sideways instead of shrinking cells below a tap target. */
const CELL_MIN_PX = 36;
const CELL_MAX_PX = 64;

const SHAPE_NAMES = { round: "redonda", square: "cuadrada" } as const;

/** Where each row of chairs goes inside the table button (its padding leaves room for them). */
const CHAIR_ROWS = {
  "top-bottom": ["inset-x-2 top-0 h-1.5 flex-row", "inset-x-2 bottom-0 h-1.5 flex-row"],
  "left-right": ["inset-y-2 left-0 w-1.5 flex-col", "inset-y-2 right-0 w-1.5 flex-col"],
} as const;

/** The chairs of a table, small bars along its long sides (see `tableChairs`). */
function Chairs({ layout }: { layout: Pick<TableLayout, "shape" | "seats" | "rotation"> }) {
  const { sides, perSide } = tableChairs(layout);
  return CHAIR_ROWS[sides].map((row) => (
    <span key={row} aria-hidden className={cn("pointer-events-none absolute flex items-center justify-evenly", row)}>
      {Array.from({ length: perSide }, (_, i) => (
        <span key={i} className={cn("rounded-full bg-stone-400", sides === "top-bottom" ? "h-1 w-2" : "h-2 w-1")} />
      ))}
    </span>
  ));
}

const area = (rect: FloorRect): CSSProperties => ({
  gridColumn: `${rect.x + 1} / span ${rect.w}`,
  gridRow: `${rect.y + 1} / span ${rect.h}`,
});

/**
 * What the owner can touch on the grid: the plan items (tables, areas, door; «Mover»), the decorations
 * («Decorar») or nothing (painting: every press goes to the grid, so the brush can pass under the tables).
 */
export type GridInteraction = "plan" | "decor" | "none";

/**
 * One floor of the plan seen from above: one square per cell painted with its material, the decorations, and on
 * the first floor the kitchen, the pickup counter and the delivery door; then the tables of that floor. Taps are
 * handled by the editor (`onGridClick` with the cell under the pointer); items start drags with
 * `onItemPointerDown`, and painting starts with `onGridPointerDown`. Cells in conflict are painted red.
 */
export function FloorGrid({
  draft,
  floor,
  tables,
  selection,
  conflicts,
  edgeHighlight,
  ghost,
  draggingKey,
  interaction,
  draggable,
  gridRef,
  onGridClick,
  onGridPointerDown,
  onItemPointerDown,
}: {
  draft: FloorDraft;
  /** Index of the floor drawn. */
  floor: number;
  tables: readonly FloorTableView[];
  selection: FloorItem | null;
  conflicts: { cells: ReadonlySet<string>; items: ReadonlySet<string> };
  /** Marks the edge cells (placing the delivery door). */
  edgeHighlight: boolean;
  /** Where a drag would drop (or the rectangle a fill would paint), and whether it may. */
  ghost: { rect: FloorRect; ok: boolean } | null;
  /** Item being dragged (drawn faded). */
  draggingKey: string | null;
  interaction: GridInteraction;
  /** Plan items can be dragged (select tool, not choosing a destination); decorations always can while decorating. */
  draggable: boolean;
  gridRef: RefObject<HTMLDivElement | null>;
  onGridClick(event: MouseEvent<HTMLDivElement>): void;
  /** Only while painting. */
  onGridPointerDown?(event: PointerEvent<HTMLDivElement>): void;
  onItemPointerDown(item: FloorItem, origin: FloorCell, event: PointerEvent<HTMLButtonElement>): void;
}) {
  const { plan, layouts } = draft;
  const { cols, rows } = plan;
  const level = plan.floors[floor] ?? plan.floors[0];
  const ground = floor === 0;
  const template: CSSProperties = {
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  };
  const selectedKey = selection ? itemKey(selection) : null;

  const cells: ReactNode[] = [];
  const edges: ReactNode[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const material = materialAt(level?.terrain ?? null, cols, { x, y });
      cells.push(<div key={cellKey({ x, y })} data-cell={cellKey({ x, y })} data-material={material} style={materialStyle(material)} />);
      if (edgeHighlight && isEdgeCell({ x, y }, cols, rows)) {
        edges.push(<div key={cellKey({ x, y })} className="bg-blue-400/15 ring-2 ring-blue-400/80 ring-inset" style={area({ x, y, w: 1, h: 1 })} />);
      }
    }
  }

  /**
   * Shared props of every item button.
   * @param look Its own colors.
   * @param active Whether it takes taps and drags in the current mode (otherwise taps pass through to the grid).
   */
  const itemProps = (item: FloorItem, rect: FloorRect, label: string, look: string, active: boolean, canDrag: boolean) => {
    const key = itemKey(item);
    return {
      type: "button" as const,
      "data-item": key,
      "data-x": rect.x,
      "data-y": rect.y,
      "aria-label": label,
      "aria-pressed": selectedKey === key,
      title: label,
      style: area(rect),
      tabIndex: active ? undefined : -1,
      onPointerDown: active && canDrag ? (event: PointerEvent<HTMLButtonElement>) => onItemPointerDown(item, rect, event) : undefined,
      className: cn(
        "relative flex min-w-0 items-center justify-center overflow-hidden rounded-md text-xs font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "pointer-events-auto" : "pointer-events-none",
        active && canDrag && "cursor-grab touch-none active:cursor-grabbing",
        selectedKey === key && "ring-2 ring-primary ring-offset-1",
        conflicts.items.has(key) && "outline-2 outline-destructive",
        draggingKey === key && "opacity-40",
        look,
      ),
    };
  };
  const planActive = interaction === "plan";
  const decorActive = interaction === "decor";

  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/40 p-2">
      <div
        ref={gridRef}
        role="group"
        aria-label={`Plano del local, ${level?.name ?? ""}, ${cols} columnas por ${rows} filas`}
        data-testid="floor-grid"
        data-floor={floor}
        className={cn("relative mx-auto", interaction === "none" && "cursor-crosshair touch-none select-none")}
        style={{ aspectRatio: `${cols} / ${rows}`, minWidth: cols * CELL_MIN_PX, maxWidth: cols * CELL_MAX_PX }}
        onClick={onGridClick}
        onPointerDown={onGridPointerDown}
      >
        <div aria-hidden className="absolute inset-0 grid gap-px bg-border p-px" style={template}>
          {cells}
        </div>

        <div className="pointer-events-none absolute inset-0 grid gap-px p-px" style={template}>
          {level?.decor.map((decor, index) => {
            const item: FloorItem = { kind: "decor", index };
            const rect = { x: decor.x, y: decor.y, w: 1, h: 1 };
            const label = DECOR_LABELS[decor.kind];
            if (!decorActive) {
              return (
                <span
                  key={`decor:${index}`}
                  role="img"
                  aria-label={label}
                  title={label}
                  className={cn("pointer-events-none flex items-center justify-center p-0.5", conflicts.items.has(itemKey(item)) && "outline-2 outline-destructive")}
                  style={area(rect)}
                >
                  <DecorIcon kind={decor.kind} className="size-full max-h-10 max-w-10" />
                </span>
              );
            }
            return (
              <button key={`decor:${index}`} {...itemProps(item, rect, label, "bg-transparent p-0.5", true, true)} data-decor={decor.kind}>
                <DecorIcon kind={decor.kind} className="pointer-events-none size-full max-h-10 max-w-10" />
              </button>
            );
          })}
          {ground ? (
            <button
              {...itemProps(
                { kind: "kitchen" },
                plan.kitchen,
                `Cocina, ${plan.kitchen.w} por ${plan.kitchen.h} celdas`,
                "flex-col gap-0.5 bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-soft-foreground/30",
                planActive,
                draggable,
              )}
            >
              <ChefHatIcon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">Cocina</span>
            </button>
          ) : null}
          {ground && plan.pickup ? (
            <button
              {...itemProps(
                { kind: "pickup" },
                plan.pickup,
                `Mesón de retiro, ${plan.pickup.w} por ${plan.pickup.h} celdas`,
                "flex-col gap-0.5 bg-green-100 text-green-800 ring-1 ring-green-700/30",
                planActive,
                draggable,
              )}
            >
              <ShoppingBagIcon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">Retiro</span>
            </button>
          ) : null}
          {ground && plan.door ? (
            <button
              {...itemProps(
                { kind: "door" },
                { ...plan.door, w: 1, h: 1 },
                "Puerta de delivery",
                "bg-blue-100 text-blue-800 ring-1 ring-blue-700/30",
                planActive,
                draggable,
              )}
            >
              <DoorOpenIcon className="size-4" aria-hidden />
            </button>
          ) : null}
          {tables.map((table) => {
            const layout = layouts[table.id];
            if (!layout || layout.floor !== floor) return null;
            const rect = tableFootprint(layout);
            // The orientation is named only where it shows (see `tableChairs`).
            const turned = tableChairs(layout).sides === "left-right";
            const label = `${table.label}, ${SHAPE_NAMES[layout.shape]}, ${layout.seats} puestos${turned ? ", vertical" : ""}${table.active ? "" : ", inactiva"}`;
            return (
              <button
                key={table.id}
                {...itemProps({ kind: "table", id: table.id }, rect, label, "bg-transparent p-1.5", planActive, draggable)}
                data-rotation={layout.rotation}
              >
                <Chairs layout={layout} />
                <span
                  className={cn(
                    "flex size-full min-w-0 flex-col items-center justify-center border leading-none",
                    layout.shape === "round" ? "rounded-full" : "rounded-md",
                    table.active ? "border-stone-400 bg-stone-100 text-foreground" : "border-dashed border-stone-300 bg-muted text-muted-foreground",
                  )}
                >
                  <span className="max-w-full truncate px-0.5 text-[11px]">{shortTableLabel(table.label)}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{layout.seats}p</span>
                </span>
              </button>
            );
          })}
        </div>

        <div aria-hidden className="pointer-events-none absolute inset-0 grid gap-px p-px" style={template}>
          {edges}
          {[...conflicts.cells].map((key) => {
            const [x = 0, y = 0] = key.split(",").map(Number);
            return <div key={key} data-testid="floor-conflict" className="rounded-sm bg-destructive/40 ring-2 ring-destructive ring-inset" style={area({ x, y, w: 1, h: 1 })} />;
          })}
          {ghost ? (
            <div
              className={cn("rounded-md border-2 border-dashed", ghost.ok ? "border-primary bg-primary/15" : "border-destructive bg-destructive/15")}
              style={area(ghost.rect)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
