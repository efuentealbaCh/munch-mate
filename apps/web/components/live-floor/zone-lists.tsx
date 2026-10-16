"use client";

import type { ReactNode } from "react";
import { ALERT_COLORS, type LiveModel, type LiveTarget, payingChip, type PlacedTable, TABLE_COLORS, TABLE_STATE_LABELS } from "@/lib/live-floor";
import { QueueList, type QueueRowData, queueRows, TableLegend } from "./panels";

function Zone({ title, count, children, testId }: { title: string; count?: number; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10" aria-label={title} data-testid={testId}>
      <h3 className="flex items-center justify-between gap-2 text-base font-bold">
        {title}
        {count !== undefined ? <span className="text-sm font-semibold text-muted-foreground tabular-nums">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/**
 * Phones and narrow screens: the same live data as the scene, as a list per zone. Tables are colored chips;
 * the kitchen lists its tickets per status with their timer; the counter and the deliveries their queues. With more
 * than one floor the tables are grouped by floor (the badge counts the ones needing someone).
 */
export function ZoneLists({ model, now, onSelect, riders }: { model: LiveModel; now: number; onSelect(target: LiveTarget): void; riders?: ReactNode }) {
  const kitchenRows = queueRows("kitchen", model, now);
  const chips = (tables: readonly PlacedTable[], label: string) => (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={label}>
      {tables.map((table) => {
        const state = model.tableStates.get(table.id);
        const indicator = state?.indicator ?? "free";
        const colors = TABLE_COLORS[state?.base ?? "free"];
        const alert = indicator === "waiter" || indicator === "bill" ? ALERT_COLORS[indicator] : null;
        const chip = state?.session ? payingChip(state.session) : null;
        return (
          <li key={table.id}>
            <button
              type="button"
              className="flex h-full w-full flex-col items-start gap-0.5 rounded-xl border-2 px-2.5 py-2 text-left"
              // Calls and bill requests get a second outline in their pin color, so they stand out in the grid.
              style={{ background: colors.top, borderColor: alert ?? colors.side, outline: alert ? `2px solid ${alert}` : undefined, outlineOffset: 2 }}
              onClick={() => onSelect({ kind: "table", id: table.id })}
              data-testid="live-table-chip"
              data-state={indicator}
            >
              <span className="truncate text-sm font-bold text-stone-900">{table.label}</span>
              <span className="text-[11px] leading-tight font-medium text-stone-700">{chip ?? TABLE_STATE_LABELS[indicator]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  const multiFloor = model.floors.length > 1;
  return (
    <div className="flex flex-col gap-3">
      {model.layout.dining ? (
        <Zone title="Salón" count={model.layout.tables.length} testId="live-dining-list">
          <TableLegend />
          {multiFloor
            ? model.floors
                .filter((tab) => tab.tables > 0)
                .map((tab) => (
                  <div key={tab.index} className="flex flex-col gap-1.5" data-testid="live-floor-group">
                    <h4 className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                      {tab.name} · {tab.tables}
                      {tab.attention > 0 ? (
                        <span
                          className="grid min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] leading-[18px] font-bold text-white tabular-nums"
                          style={{ background: tab.waiter > 0 ? ALERT_COLORS.waiter : ALERT_COLORS.bill }}
                          aria-label={`${tab.attention} ${tab.attention === 1 ? "mesa requiere" : "mesas requieren"} atención`}
                        >
                          {tab.attention}
                        </span>
                      ) : null}
                    </h4>
                    {chips(
                      model.layout.tables.filter((t) => t.layout.floor === tab.index),
                      `Mesas de ${tab.name}`,
                    )}
                  </div>
                ))
            : chips(model.layout.tables, "Mesas")}
        </Zone>
      ) : null}
      <Zone title="Cocina" count={kitchenRows.length} testId="live-kitchen-list">
        {model.groups.map((group) => {
          const rows: QueueRowData[] = kitchenRows.filter((row) => group.tickets.some((t) => t.order.id === row.key));
          return (
            <div key={group.key} className="flex flex-col gap-1">
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: group.color }} aria-hidden />
                {group.label} · {group.tickets.length}
              </h4>
              <QueueList rows={rows} tab="kitchen" onSelect={onSelect} label={group.label} />
            </div>
          );
        })}
      </Zone>
      {model.tabs.includes("pickup") ? (
        <Zone title="Retiro" count={model.pickupQueue.length} testId="live-pickup-list">
          <QueueList rows={queueRows("pickup", model, now)} tab="pickup" onSelect={onSelect} />
        </Zone>
      ) : null}
      {model.tabs.includes("delivery") ? (
        <Zone title="Repartos" count={model.deliveryQueue.length} testId="live-delivery-list">
          {riders}
          <QueueList rows={queueRows("delivery", model, now)} tab="delivery" onSelect={onSelect} />
        </Zone>
      ) : null}
    </div>
  );
}
