"use client";

import type { WeeklyHours } from "@app/types";
import { ChevronDownIcon, ClockIcon } from "lucide-react";
import { WeeklyHoursList } from "@/components/weekly-hours-list";
import { useNow } from "@/hooks/use-now";
import { formatDayRanges, weekdayIndex } from "@/lib/opening-hours";

/**
 * Collapsible weekly schedule for the public menu header (native <details>: keyboard and screen readers
 * work without extra code). "Today" uses the visitor's clock, so it appears after hydration.
 */
export function PublicOpeningHours({ hours }: { hours: WeeklyHours }) {
  const now = useNow(60_000);
  const today = now ? weekdayIndex(new Date(now)) : null;
  const todayRanges = today === null ? null : (hours[today] ?? []);

  return (
    <details className="group mt-1 self-stretch text-sm" data-testid="opening-hours">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-md font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ClockIcon className="size-4 text-muted-foreground" aria-hidden />
        <span>
          Horario
          {todayRanges ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · Hoy: {formatDayRanges(todayRanges)}
            </span>
          ) : null}
        </span>
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <WeeklyHoursList hours={hours} today={today} className="mt-2 max-w-xs" />
    </details>
  );
}
