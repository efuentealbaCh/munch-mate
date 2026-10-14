"use client";

import type { FloorCell } from "@app/types";
import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { FloorTarget } from "@/lib/floor-editor";

/** Pixels the pointer must travel before a press becomes a drag (below that it is a tap). */
const DRAG_THRESHOLD_PX = 8;

/**
 * Drag and drop on the plan grid with pointer events (mouse, touch and pen alike). The press starts on an item
 * or a list entry (which must have `touch-action: none`, so a finger drag is not taken as a scroll); moves are
 * tracked on the window, so the pointer may leave the item. The target is the cell under the pointer minus where
 * the item was grabbed, so a 4 × 3 kitchen grabbed by its middle does not jump.
 * @param gridRef The element covering exactly the `cols × rows` cells.
 * @param onDrop Called with the new top-left cell (may be outside the grid: callers clamp or refuse).
 */
export function useFloorDrag(
  gridRef: RefObject<HTMLDivElement | null>,
  cols: number,
  rows: number,
  onDrop: (source: FloorTarget, cell: FloorCell) => void,
) {
  const [drag, setDrag] = useState<{ source: FloorTarget; cell: FloorCell | null } | null>(null);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  });
  // The click that follows a drag must not count as a tap on the cell underneath.
  const justDragged = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  /** The cell under a point of the screen, or null outside the grid. */
  const cellAt = useCallback(
    (clientX: number, clientY: number): FloorCell | null => {
      const box = gridRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return null;
      const x = Math.floor(((clientX - box.left) / box.width) * cols);
      const y = Math.floor(((clientY - box.top) / box.height) * rows);
      return x >= 0 && y >= 0 && x < cols && y < rows ? { x, y } : null;
    },
    [gridRef, cols, rows],
  );

  /**
   * Starts tracking a press.
   * @param origin Top-left cell of the item on the plan (null for a table from the list: grabbed by its corner).
   */
  const start = useCallback(
    (source: FloorTarget, origin: FloorCell | null, event: ReactPointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      cleanup.current?.();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const pressed = cellAt(startX, startY);
      const grab = origin && pressed ? { x: pressed.x - origin.x, y: pressed.y - origin.y } : { x: 0, y: 0 };
      let moved = false;
      let target: FloorCell | null = null;

      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
        moved = true;
        const cell = cellAt(e.clientX, e.clientY);
        target = cell ? { x: cell.x - grab.x, y: cell.y - grab.y } : null;
        setDrag({ source, cell: target });
      };
      const end = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        stop();
        setDrag(null);
        if (!moved) return;
        justDragged.current = true;
        setTimeout(() => {
          justDragged.current = false;
        }, 0);
        if (e.type === "pointerup" && target) onDropRef.current(source, target);
      };
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        cleanup.current = null;
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      cleanup.current = stop;
    },
    [cellAt],
  );

  return { drag, start, cellAt, justDragged };
}
