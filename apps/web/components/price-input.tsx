"use client";

import type { ComponentProps } from "react";
import { formatPriceInput, parsePriceInput } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Text input for CLP prices with a "$" prefix and a numeric keyboard on phones. Accepts "3990" or "3.990";
 * on blur a valid value is rewritten with thousands separators. The form converts it with parsePriceInput.
 */
export function PriceInput({ className, onBlur, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <div
      className={cn(
        "flex h-10 w-full min-w-0 items-center overflow-hidden rounded-lg border border-input bg-card text-base transition-colors md:text-sm",
        "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        "has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20",
        className,
      )}
    >
      <span className="pl-3 text-muted-foreground" aria-hidden>
        $
      </span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-foreground tabular-nums outline-none"
        onBlur={(event) => {
          const amount = parsePriceInput(event.target.value);
          if (amount !== null) event.target.value = formatPriceInput(amount);
          onBlur?.(event);
        }}
        {...props}
      />
    </div>
  );
}
