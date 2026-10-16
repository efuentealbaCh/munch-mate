"use client";

import type { FloorCell, FloorRect } from "@app/types";
import { rectCells } from "@app/utils";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { cellKey, lineCells, rectBetween } from "@/lib/floor-editor";

/**
 * The painting gesture on the plan grid, with pointer events (mouse, touch and pen alike; the grid must have
 * `touch-action: none` while painting, so a finger drag paints instead of scrolling). A stroke paints every cell
 * the pointer crosses, filling the gaps of quick moves; a fill drag (the «Rellenar» brush or Shift) previews the
 * rectangle between the pressed cell and the current one and paints it on release.
 * @param cellAt The cell under a point of the screen, or null outside the grid.
 * @param onStroke Every cell of the gesture so far (a stroke reports while it goes; a fill only on release),
 *   `final` on release. A cancelled fill reports no cells.
 */
export function useFloorPaint(
  cellAt: (clientX: number, clientY: number) => FloorCell | null,
  onStroke: (cells: FloorCell[], final: boolean) => void,
) {
  const [fillRect, setFillRect] = useState<FloorRect | null>(null);
  const onStrokeRef = useRef(onStroke);
  useEffect(() => {
    onStrokeRef.current = onStroke;
  });
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  /**
   * Starts a gesture from a press on the grid.
   * @param fill Paint the dragged rectangle instead of the cells crossed.
   * @returns Whether a gesture started (false outside the grid or with another mouse button).
   */
  const start = useCallback(
    (event: ReactPointerEvent, fill: boolean): boolean => {
      if (event.pointerType === "mouse" && event.button !== 0) return false;
      const first = cellAt(event.clientX, event.clientY);
      if (!first) return false;
      // No text selection or native drag while the mouse paints.
      event.preventDefault();
      cleanup.current?.();
      const pointerId = event.pointerId;
      const stroke = new Map<string, FloorCell>([[cellKey(first), first]]);
      let last = first;
      if (fill) setFillRect(rectBetween(first, first));
      else onStrokeRef.current([first], false);

      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        const cell = cellAt(e.clientX, e.clientY);
        if (!cell || (cell.x === last.x && cell.y === last.y)) return;
        if (fill) {
          setFillRect(rectBetween(first, cell));
        } else {
          for (const crossed of lineCells(last, cell)) stroke.set(cellKey(crossed), crossed);
          onStrokeRef.current([...stroke.values()], false);
        }
        last = cell;
      };
      const end = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        stop();
        setFillRect(null);
        if (!fill) onStrokeRef.current([...stroke.values()], true);
        else onStrokeRef.current(e.type === "pointerup" ? rectCells(rectBetween(first, last)) : [], true);
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
      return true;
    },
    [cellAt],
  );

  return { start, fillRect };
}
