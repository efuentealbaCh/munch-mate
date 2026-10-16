"use client";

import { ALERT_COLORS, type FloorTab } from "@/lib/live-floor";
import { cn } from "@/lib/utils";

/** "2 mesas llaman" / "1 mesa pidió la cuenta": what a tab's badge means, for its accessible name. */
function attentionText(tab: FloorTab): string {
  const parts = [
    tab.waiter > 0 ? `${tab.waiter} ${tab.waiter === 1 ? "mesa llama al garzón" : "mesas llaman al garzón"}` : null,
    tab.bill > 0 ? `${tab.bill} ${tab.bill === 1 ? "mesa pidió la cuenta" : "mesas pidieron la cuenta"}` : null,
  ].filter((p): p is string => p !== null);
  return parts.join(", ");
}

/**
 * Which floor the scene draws, shown only when the plan has more than one. Each tab carries a badge with its tables
 * calling the waiter or asking for the bill (amber when someone calls, orange for bills, the pins' colors), so an
 * alert on a floor that is not on screen is not missed.
 */
export function FloorTabs({ tabs, floor, onChange, className }: { tabs: readonly FloorTab[]; floor: number; onChange(floor: number): void; className?: string }) {
  if (tabs.length < 2) return null;
  return (
    <div
      className={cn("inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-background/80 p-0.5 shadow-sm backdrop-blur-sm", className)}
      role="group"
      aria-label="Piso del plano"
      data-testid="live-floor-tabs"
    >
      {tabs.map((tab) => {
        const selected = tab.index === floor;
        const alert = attentionText(tab);
        return (
          <button
            key={tab.index}
            type="button"
            className={cn(
              "relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
            )}
            aria-pressed={selected}
            aria-label={alert ? `${tab.name}: ${alert}` : tab.name}
            title={alert || undefined}
            onClick={() => onChange(tab.index)}
            data-testid="live-floor-tab"
            data-floor={tab.index}
            data-attention={tab.attention}
          >
            <span className="max-w-32 truncate">{tab.name}</span>
            {tab.attention > 0 ? (
              <span
                className="grid min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] leading-[18px] font-bold text-white tabular-nums ring-2 ring-background"
                style={{ background: tab.waiter > 0 ? ALERT_COLORS.waiter : ALERT_COLORS.bill }}
                aria-hidden
              >
                {tab.attention}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
