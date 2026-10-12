"use client";

import type { DailySummary } from "@app/types";
import { ChevronLeftIcon, ChevronRightIcon, InboxIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useNow } from "@/hooks/use-now";
import { useSocketEvent } from "@/hooks/use-realtime";
import {
  type BreakdownRow,
  businessDateLabel,
  canViewSales,
  channelRows,
  countedOrders,
  paymentRows,
  shiftDate,
  todayIn,
} from "@/lib/daily-summary";
import { reportsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useRestaurant } from "../restaurant-context";
import { useRestaurantRealtime } from "../restaurant-realtime";

/** Wait after a burst of order events before refetching (one request per burst, not per event). */
const LIVE_REFRESH_DELAY_MS = 1500;

/** "Ventas": daily summary for closing the register (owner, cashier). */
export function SalesView() {
  const { restaurant } = useRestaurant();
  if (!canViewSales(restaurant.myRoles)) {
    return (
      <AccessDenied
        restaurantId={restaurant.id}
        title="Sin acceso"
        description="Solo dueños y caja pueden ver las ventas del día."
      />
    );
  }
  return <SalesReport />;
}

function SalesReport() {
  const { restaurant } = useRestaurant();
  const { socket, syncCount } = useRestaurantRealtime();
  const now = useNow(60_000);
  // Business dates are in the restaurant's zone, like the api's.
  const today = todayIn(restaurant.timezone, now ? new Date(now) : new Date());
  const [date, setDate] = useState(today);
  const dateInputId = useId();
  const load = useCallback(() => reportsApi.daily(restaurant.id, date), [restaurant.id, date]);
  const { data, error, loading, reload } = useApiQuery<DailySummary>(load);
  // useApiQuery keeps the previous day visible while loading: only show data that belongs to the chosen date.
  const summary = data?.date === date ? data : undefined;
  const isToday = date === today;

  // The api refuses days that do not exist (INVALID_DATE) or are after today in the restaurant's zone
  // (FUTURE_DATE): a tampered date input, or this device's clock ahead of the restaurant's. Say why and go
  // back to today; if today itself is refused (clock skew), the error block below shows the message.
  // Only once the run for the current date has finished (`loading` false), so a stale error never resets a
  // date chosen meanwhile.
  useEffect(() => {
    if (loading || date === today || !hasCode(error, "INVALID_DATE", "FUTURE_DATE")) return;
    toast.error(errorMessage(error));
    setDate(today);
  }, [loading, error, date, today]);

  // Today's numbers follow the board: refetch after order events and after a reconnect (missed events).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(reload, LIVE_REFRESH_DELAY_MS);
  }, [reload]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useSocketEvent(socket, "order.created", () => isToday && scheduleReload());
  useSocketEvent(socket, "order.updated", () => isToday && scheduleReload());
  const firstSync = useRef(syncCount);
  useEffect(() => {
    if (syncCount !== firstSync.current) reload();
  }, [syncCount, reload]);

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Día del resumen" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Día anterior" onClick={() => setDate((d) => shiftDate(d, -1))}>
            <ChevronLeftIcon aria-hidden />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col items-center sm:min-w-48">
            <h2 className="text-lg font-semibold first-letter:uppercase" data-testid="sales-date" aria-live="polite">
              {businessDateLabel(date, today)}
            </h2>
            <label htmlFor={dateInputId} className="sr-only">
              Elegir fecha
            </label>
            <Input
              id={dateInputId}
              type="date"
              value={date}
              max={today}
              className="h-8 w-auto border-transparent bg-transparent text-center text-sm text-muted-foreground"
              onChange={(event) => {
                const value = event.target.value;
                // Cleared or typed past today: ignore (the api would answer an empty future day).
                if (value && value <= today) setDate(value);
              }}
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Día siguiente"
            disabled={date >= today}
            onClick={() => setDate((d) => (d < today ? shiftDate(d, 1) : d))}
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {isToday ? null : (
            <Button variant="ghost" onClick={() => setDate(today)}>
              Ir a hoy
            </Button>
          )}
          <Button variant="outline" onClick={reload} disabled={loading} aria-busy={loading || undefined}>
            {loading ? <Spinner aria-hidden data-icon="inline-start" /> : <RefreshCwIcon aria-hidden data-icon="inline-start" />}
            Actualizar
          </Button>
        </div>
      </section>

      {error && !summary ? (
        <div className="flex flex-col items-start gap-3">
          <FormError error={error} />
          <Button variant="outline" onClick={reload}>
            Reintentar
          </Button>
        </div>
      ) : !summary ? (
        <SummarySkeleton />
      ) : (
        <SummaryBody summary={summary} isToday={isToday} />
      )}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando resumen">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function SummaryBody({ summary, isToday }: { summary: DailySummary; isToday: boolean }) {
  const { currency, orders, sales } = summary;
  const money = (amount: number) => formatPrice(amount, currency);

  if (orders.total === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-12 text-center" role="status">
        <InboxIcon className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-semibold">Sin pedidos {isToday ? "hoy" : "este día"}</p>
        <p className="text-sm text-muted-foreground">
          {isToday ? "Las ventas aparecen aquí a medida que llegan los pedidos." : "No hubo pedidos en esta fecha."}
        </p>
      </div>
    );
  }

  const channels = channelRows(summary);
  const payments = paymentRows(summary);

  return (
    <div className="flex flex-col gap-5" data-testid="sales-summary">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Total vendido"
          value={money(sales.total)}
          hint={sales.deliveryFees > 0 ? `Incluye ${money(sales.deliveryFees)} de despacho` : `Cobrado ${money(sales.paid)}`}
          testId="kpi-total"
          emphasis
        />
        <Kpi
          label="Pedidos"
          value={String(countedOrders(summary))}
          hint={`${orders.completed} ${orders.completed === 1 ? "completado" : "completados"}`}
          testId="kpi-orders"
        />
        <Kpi label="Ticket promedio" value={money(sales.averageTicket)} testId="kpi-average" />
        <Kpi
          label="Pendiente de cobro"
          value={money(sales.unpaid)}
          hint={sales.unpaid > 0 ? "Pedidos aún sin pagar" : "Todo cobrado"}
          warning={sales.unpaid > 0}
          testId="kpi-unpaid"
        />
      </dl>

      <dl className="grid grid-cols-3 gap-3 text-center">
        <Counter label="En curso" value={orders.inProgress} />
        <Counter label="Rechazados" value={orders.rejected} muted />
        <Counter label="Cancelados" value={orders.cancelled} muted />
      </dl>
      <p className="-mt-2 text-xs text-muted-foreground">
        El total incluye los pedidos completados y en curso; los rechazados y cancelados no suman.
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <BreakdownCard
          title="Por canal"
          rows={channels}
          money={money}
          empty="Sin ventas por canal."
          detail={(row) => `${row.orders} ${row.orders === 1 ? "pedido" : "pedidos"}`}
        />
        <BreakdownCard
          title="Cobrado por medio de pago"
          rows={payments}
          money={money}
          empty="Todavía no hay pagos registrados."
          footer={sales.unpaid > 0 ? `Falta cobrar ${money(sales.unpaid)}.` : null}
        />
      </div>

      <Card className="[--card-spacing:--spacing(5)]">
        <CardHeader>
          <CardTitle>
            <h3>Más vendidos</h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summary.topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin productos vendidos.</p>
          ) : (
            <ol className="flex flex-col divide-y" data-testid="top-products">
              {summary.topProducts.map((product, index) => (
                <li key={product.name} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-5 text-muted-foreground tabular-nums">{index + 1}.</span>
                  <span className="min-w-0 flex-1 break-words">{product.name}</span>
                  <span className="text-muted-foreground tabular-nums">× {product.quantity}</span>
                  <span className="w-24 text-right font-medium tabular-nums">{money(product.total)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  emphasis,
  warning,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  warning?: boolean;
  testId: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-xl px-3 py-3 ring-1",
        emphasis ? "bg-brand-soft ring-primary/20" : warning ? "bg-warning ring-warning-foreground/30" : "bg-card ring-foreground/10",
      )}
      data-testid={testId}
    >
      <dt className={cn("text-xs", warning ? "text-warning-foreground" : "text-muted-foreground")}>{label}</dt>
      <dd className={cn("text-xl font-bold tabular-nums sm:text-2xl", warning && "text-warning-foreground")}>{value}</dd>
      {hint ? <dd className={cn("text-xs", warning ? "text-warning-foreground" : "text-muted-foreground")}>{hint}</dd> : null}
    </div>
  );
}

function Counter({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-card px-2 py-2 ring-1 ring-foreground/10">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-bold tabular-nums", muted && value === 0 && "text-muted-foreground")}>{value}</dd>
    </div>
  );
}

function BreakdownCard<K extends string>({
  title,
  rows,
  money,
  empty,
  detail,
  footer,
}: {
  title: string;
  rows: BreakdownRow<K>[];
  money(amount: number): string;
  empty: string;
  detail?(row: BreakdownRow<K>): string;
  footer?: string | null;
}) {
  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardHeader>
        <CardTitle>
          <h3>{title}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li key={row.key} className="flex flex-col gap-1 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">
                    {row.label}
                    {detail ? <span className="font-normal text-muted-foreground"> · {detail(row)}</span> : null}
                  </span>
                  <span className="font-semibold tabular-nums">{money(row.amount)}</span>
                </div>
                {/* Decorative: the amount and the percentage are in the text. */}
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${row.percent}%` }} />
                </div>
                <span className="sr-only">{row.percent}% del total</span>
              </li>
            ))}
          </ul>
        )}
        {footer ? <p className="text-sm text-warning-foreground">{footer}</p> : null}
      </CardContent>
    </Card>
  );
}
