"use client";

import type { FloorCell, FloorRect, FloorTableView } from "@app/types";
import { isEdgeCell, tableFootprint } from "@app/utils";
import { ChefHatIcon, DoorOpenIcon, ShoppingBagIcon } from "lucide-react";
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode, RefObject } from "react";
import { cellKey, type FloorDraft, type FloorItem, itemKey, shortTableLabel } from "@/lib/floor-editor";
import { cn } from "@/lib/utils";

/** Smallest and largest cell on screen (px): phones scroll sideways instead of shrinking cells below a tap target. */
const CELL_MIN_PX = 36;
const CELL_MAX_PX = 64;

const SHAPE_NAMES = { round: "redonda", square: "cuadrada" } as const;

const area = (rect: FloorRect): CSSProperties => ({
  gridColumn: `${rect.x + 1} / span ${rect.w}`,
  gridRow: `${rect.y + 1} / span ${rect.h}`,
});

/**
 * The plan seen from above: one square per cell, with the kitchen, the pickup counter, the delivery door and the
 * tables on top. Taps are handled by the editor (`onGridClick` with the cell under the pointer); items start
 * drags with `onItemPointerDown`. Cells shared by two items are painted red.
 */
export function FloorGrid({
  draft,
  tables,
  selection,
  conflicts,
  edgeHighlight,
  ghost,
  draggingKey,
  draggable,
  gridRef,
  onGridClick,
  onItemPointerDown,
}: {
  draft: FloorDraft;
  tables: readonly FloorTableView[];
  selection: FloorItem | null;
  conflicts: { cells: ReadonlySet<string>; items: ReadonlySet<string> };
  /** Marks the edge cells (placing the delivery door). */
  edgeHighlight: boolean;
  /** Where a drag would drop, and whether it may. */
  ghost: { rect: FloorRect; ok: boolean } | null;
  /** Item being dragged (drawn faded). */
  draggingKey: string | null;
  /** Items can be dragged (select tool, not choosing a destination). */
  draggable: boolean;
  gridRef: RefObject<HTMLDivElement | null>;
  onGridClick(event: MouseEvent<HTMLDivElement>): void;
  onItemPointerDown(item: FloorItem, origin: FloorCell, event: PointerEvent<HTMLButtonElement>): void;
}) {
  const { plan, layouts } = draft;
  const { cols, rows } = plan;
  const template: CSSProperties = {
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  };
  const selectedKey = selection ? itemKey(selection) : null;

  const cells: ReactNode[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const edge = edgeHighlight && isEdgeCell({ x, y }, cols, rows);
      cells.push(
        <div
          key={cellKey({ x, y })}
          data-cell={cellKey({ x, y })}
          className={cn("bg-background", edge && "bg-blue-50 ring-1 ring-blue-300 ring-inset")}
        />,
      );
    }
  }

  /** Shared props of every item button (`look`: its own colors). */
  const itemProps = (item: FloorItem, rect: FloorRect, label: string, look: string) => {
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
      onPointerDown: draggable ? (event: PointerEvent<HTMLButtonElement>) => onItemPointerDown(item, rect, event) : undefined,
      className: cn(
        "pointer-events-auto relative flex min-w-0 items-center justify-center overflow-hidden rounded-md text-xs font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50",
        draggable && "cursor-grab touch-none active:cursor-grabbing",
        selectedKey === key && "ring-2 ring-primary ring-offset-1",
        conflicts.items.has(key) && "outline-2 outline-destructive",
        draggingKey === key && "opacity-40",
        look,
      ),
    };
  };

  return (
    <div className="overflow-x-auto rounded-xl border bg-muted/40 p-2">
      <div
        ref={gridRef}
        role="group"
        aria-label={`Plano del local, ${cols} columnas por ${rows} filas`}
        data-testid="floor-grid"
        className="relative mx-auto"
        style={{ aspectRatio: `${cols} / ${rows}`, minWidth: cols * CELL_MIN_PX, maxWidth: cols * CELL_MAX_PX }}
        onClick={onGridClick}
      >
        <div aria-hidden className="absolute inset-0 grid gap-px bg-border p-px" style={template}>
          {cells}
        </div>

        <div className="pointer-events-none absolute inset-0 grid gap-px p-px" style={template}>
          <button
            {...itemProps(
              { kind: "kitchen" },
              plan.kitchen,
              `Cocina, ${plan.kitchen.w} por ${plan.kitchen.h} celdas`,
              "flex-col gap-0.5 bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-soft-foreground/30",
            )}
          >
            <ChefHatIcon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">Cocina</span>
          </button>
          {plan.pickup ? (
            <button
              {...itemProps(
                { kind: "pickup" },
                plan.pickup,
                `Mesón de retiro, ${plan.pickup.w} por ${plan.pickup.h} celdas`,
                "flex-col gap-0.5 bg-green-100 text-green-800 ring-1 ring-green-700/30",
              )}
            >
              <ShoppingBagIcon className="size-4 shrink-0" aria-hidden />
              <span className="truncate">Retiro</span>
            </button>
          ) : null}
          {plan.door ? (
            <button {...itemProps({ kind: "door" }, { ...plan.door, w: 1, h: 1 }, "Puerta de delivery", "bg-blue-100 text-blue-800 ring-1 ring-blue-700/30")}>
              <DoorOpenIcon className="size-4" aria-hidden />
            </button>
          ) : null}
          {tables.map((table) => {
            const layout = layouts[table.id];
            if (!layout) return null;
            const rect = tableFootprint(layout);
            const label = `${table.label}, ${SHAPE_NAMES[layout.shape]}, ${layout.seats} puestos${table.active ? "" : ", inactiva"}`;
            return (
              <button key={table.id} {...itemProps({ kind: "table", id: table.id }, rect, label, "bg-transparent p-0.5")}>
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
