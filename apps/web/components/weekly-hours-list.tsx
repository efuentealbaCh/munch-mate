import { WEEKDAY_LABELS, type WeeklyHours } from "@app/types";
import { formatDayRanges } from "@/lib/opening-hours";
import { cn } from "@/lib/utils";

/**
 * Read-only weekly schedule (Monday first). `today` (0 = lunes) is highlighted; pass null while it is unknown
 * (first render), so server and client markup match.
 */
export function WeeklyHoursList({ hours, today, className }: { hours: WeeklyHours; today: number | null; className?: string }) {
  return (
    <dl className={cn("grid gap-1 text-sm", className)} data-testid="weekly-hours">
      {hours.map((ranges, day) => {
        const isToday = day === today;
        return (
          <div
            key={WEEKDAY_LABELS[day]}
            className={cn(
              "flex justify-between gap-4 rounded-md px-2 py-1",
              isToday && "bg-brand-soft font-semibold text-brand-soft-foreground",
            )}
            aria-current={isToday ? "date" : undefined}
          >
            <dt>
              {WEEKDAY_LABELS[day]}
              {isToday ? <span className="sr-only"> (hoy)</span> : null}
            </dt>
            <dd className={cn("text-right tabular-nums", ranges.length === 0 && !isToday && "text-muted-foreground")}>
              {formatDayRanges(ranges)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
