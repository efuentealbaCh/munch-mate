import { ORDER_LIMITS } from "@app/types";
import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * − n + control with large tap targets. Bounded to 1…ORDER_LIMITS.quantityMax (the api's limit).
 * @param label Accessible name of the group, e.g. "Cantidad de Barros Luco".
 */
export function QuantityStepper({
  value,
  onChange,
  label,
  min = 1,
  max = ORDER_LIMITS.quantityMax,
  size = "default",
  className,
}: {
  value: number;
  onChange(value: number): void;
  label: string;
  min?: number;
  max?: number;
  size?: "sm" | "default";
  className?: string;
}) {
  const buttonSize = size === "sm" ? "icon-sm" : "icon";
  return (
    <div role="group" aria-label={label} className={cn("flex items-center gap-1 rounded-lg border bg-background p-0.5", className)}>
      <Button
        type="button"
        variant="ghost"
        size={buttonSize}
        aria-label="Quitar uno"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <MinusIcon aria-hidden />
      </Button>
      <output aria-live="polite" className={cn("min-w-6 text-center font-semibold tabular-nums", size === "sm" && "text-sm")}>
        {value}
      </output>
      <Button
        type="button"
        variant="ghost"
        size={buttonSize}
        aria-label="Agregar uno"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <PlusIcon aria-hidden />
      </Button>
    </div>
  );
}
