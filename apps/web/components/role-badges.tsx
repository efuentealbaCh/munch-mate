import { RESTAURANT_ROLE_LABELS, type RestaurantRole } from "@app/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** One badge per role; owner highlighted with the brand color. */
export function RoleBadges({ roles, className }: { roles: readonly RestaurantRole[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Roles">
      {roles.map((role) => (
        <li key={role}>
          <Badge
            variant="secondary"
            className={role === "owner" ? "bg-brand-soft text-brand-soft-foreground" : undefined}
          >
            {RESTAURANT_ROLE_LABELS[role]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
