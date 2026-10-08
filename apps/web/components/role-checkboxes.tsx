"use client";

import { RESTAURANT_ROLE_LABELS, RESTAURANT_ROLES, type RestaurantRole } from "@app/types";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface RoleCheckboxesProps {
  /** Unique prefix for the checkbox ids (several groups can live on one page). */
  idPrefix: string;
  legend: string;
  value: readonly RestaurantRole[];
  onChange(roles: RestaurantRole[]): void;
  disabled?: boolean;
  invalid?: boolean;
  /** Visually hide the legend (it is still announced). */
  hideLegend?: boolean;
  /** id of an element describing the group (e.g. its error message). */
  describedBy?: string;
}

/** Group of role toggles, always emitted in RESTAURANT_ROLES order. Each option is a large tap target. */
export function RoleCheckboxes({
  idPrefix,
  legend,
  value,
  onChange,
  disabled,
  invalid,
  hideLegend,
  describedBy,
}: RoleCheckboxesProps) {
  const toggle = (role: RestaurantRole, checked: boolean) => {
    const next = new Set(value);
    if (checked) next.add(role);
    else next.delete(role);
    onChange(RESTAURANT_ROLES.filter((r) => next.has(r)));
  };

  return (
    <fieldset aria-describedby={describedBy} disabled={disabled}>
      <legend className={cn("mb-2 text-sm font-medium", hideLegend && "sr-only")}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {RESTAURANT_ROLES.map((role) => {
          const id = `${idPrefix}-${role}`;
          const checked = value.includes(role);
          return (
            <label
              key={role}
              htmlFor={id}
              className={cn(
                "flex min-h-10 items-center gap-2 rounded-lg border bg-card px-3 text-sm transition-colors select-none",
                "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                checked ? "border-primary/40 bg-brand-soft text-brand-soft-foreground" : "hover:bg-muted",
                invalid && !checked && "border-destructive/50",
                disabled ? "opacity-60" : "cursor-pointer",
              )}
            >
              <Checkbox
                id={id}
                checked={checked}
                disabled={disabled}
                aria-invalid={invalid || undefined}
                onCheckedChange={(state) => toggle(role, state === true)}
              />
              {RESTAURANT_ROLE_LABELS[role]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
