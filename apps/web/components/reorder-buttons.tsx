"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ReorderButtonsProps {
  /** Name of the item, for the accessible labels ("Subir Sándwiches"). */
  itemName: string;
  index: number;
  count: number;
  onMove(delta: -1 | 1): void;
  size?: "icon" | "icon-sm";
  disabled?: boolean;
  className?: string;
}

/**
 * Up/down buttons: the keyboard and screen-reader friendly way to reorder (no drag and drop needed).
 * At the edges the buttons are aria-disabled instead of disabled, so focus is not lost when the item
 * reaches the top or bottom after a move.
 */
export function ReorderButtons({ itemName, index, count, onMove, size = "icon", disabled, className }: ReorderButtonsProps) {
  const first = index === 0;
  const last = index === count - 1;
  return (
    <div className={cn("flex gap-1", className)}>
      <Button
        type="button"
        variant="ghost"
        size={size}
        aria-label={`Subir ${itemName}`}
        aria-disabled={first || disabled || undefined}
        className="aria-disabled:opacity-40"
        onClick={() => !first && !disabled && onMove(-1)}
      >
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size={size}
        aria-label={`Bajar ${itemName}`}
        aria-disabled={last || disabled || undefined}
        className="aria-disabled:opacity-40"
        onClick={() => !last && !disabled && onMove(1)}
      >
        <ArrowDownIcon aria-hidden />
      </Button>
    </div>
  );
}
