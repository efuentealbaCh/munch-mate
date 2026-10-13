"use client";

import { SALES_EXPORT_KINDS, type SalesExportKind, type SalesReport } from "@app/types";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useApiQuery } from "@/hooks/use-api-query";
import { saveBlob } from "@/lib/download";
import { reportsApi } from "@/lib/endpoints";
import { errorMessage } from "@/lib/errors";
import { formatPrice } from "@/lib/money";
import { type DateRange, EXPORT_LABELS, rangePresets, rangeProblem, shortDate } from "@/lib/sales-range";
import { useRestaurant } from "../restaurant-context";

/** Downloads of one range as CSV for Excel, plus printing the page (phase 8). */
export function ExportButtons({ range, compact = false }: { range: DateRange; compact?: boolean }) {
  const { restaurant } = useRestaurant();
  const [working, setWorking] = useState<SalesExportKind | null>(null);

  async function download(kind: SalesExportKind) {
    setWorking(kind);
    try {
      const file = await reportsApi.salesCsv(restaurant.id, range.from, range.to, kind);
      saveBlob(file.blob, file.filename);
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Exportar ventas">
      {SALES_EXPORT_KINDS.map((kind) => (
        <Button
          key={kind}
          variant="outline"
          size={compact ? "sm" : "default"}
          disabled={working !== null}
          aria-busy={working === kind || undefined}
          onClick={() => void download(kind)}
          data-testid={`export-${kind}`}
        >
          {working === kind ? <Spinner aria-hidden data-icon="inline-start" /> : <DownloadIcon aria-hidden data-icon="inline-start" />}
          Excel · {EXPORT_LABELS[kind]}
        </Button>
      ))}
      <Button variant="outline" size={compact ? "sm" : "default"} onClick={() => window.print()}>
        <PrinterIcon aria-hidden data-icon="inline-start" />
        Imprimir
      </Button>
    </div>
  );
}

/** "Rango": sales between two dates with one row per day, exportable and printable. */
export function SalesRangeView({ today }: { today: string }) {
  const { restaurant } = useRestaurant();
  const id = useId();
  const presets = rangePresets(today);
  const [range, setRange] = useState<DateRange>(presets[2]!.range);
  const problem = rangeProblem(range, today);
  const load = useCallback(
    () => (problem ? Promise.resolve(null) : reportsApi.sales(restaurant.id, range.from, range.to)),
    [restaurant.id, range.from, range.to, problem],
  );
  const { data, error, loading } = useApiQuery<SalesReport | null>(load);
  // useApiQuery keeps the previous range visible while loading: only show the report of the chosen dates.
  const report = data && data.from === range.from && data.to <= range.to ? data : null;
  const money = (amount: number) => formatPrice(amount, restaurant.currency);

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Rango de fechas" className="flex flex-col gap-3 print:hidden">
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              size="sm"
              variant={preset.range.from === range.from && preset.range.to === range.to ? "default" : "outline"}
              onClick={() => setRange(preset.range)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-from`}>
            Desde
            <Input id={`${id}-from`} type="date" value={range.from} max={today} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-to`}>
            Hasta
            <Input id={`${id}-to`} type="date" value={range.to} max={today} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </label>
        </div>
        {problem ? <p className="text-sm text-destructive" role="alert">{problem}</p> : <ExportButtons range={range} />}
      </section>

      <h2 className="text-lg font-semibold" data-testid="range-title">
        <span className="hidden print:inline">{restaurant.name} · </span>
        Ventas del {shortDate(range.from)} al {shortDate(range.to)}
      </h2>

      {problem ? null : error && !report ? (
        <FormError error={error} />
      ) : !report || loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="flex flex-col gap-5" data-testid="range-report">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total vendido" value={money(report.sales.total)} />
            <Stat label="Pedidos" value={String(report.days.reduce((sum, day) => sum + day.orders, 0))} />
            <Stat label="Propinas (aparte)" value={money(report.tips)} testId="range-tips" />
            <Stat label="Descuentos dados" value={money(report.sales.discounts)} />
          </dl>
          <Card className="[--card-spacing:--spacing(5)]">
            <CardHeader>
              <CardTitle>
                <h3>Por día</h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="range-days">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium">Fecha</th>
                    <th className="py-1 text-right font-medium">Pedidos</th>
                    <th className="py-1 text-right font-medium">Ventas</th>
                    <th className="py-1 text-right font-medium">Propinas</th>
                  </tr>
                </thead>
                <tbody className="divide-y tabular-nums">
                  {report.days.map((day) => (
                    <tr key={day.date}>
                      <td className="py-1.5">{shortDate(day.date)}</td>
                      <td className="py-1.5 text-right">{day.orders}</td>
                      <td className="py-1.5 text-right">{money(day.total)}</td>
                      <td className="py-1.5 text-right">{money(day.tips)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold tabular-nums">
                    <td className="py-1.5">Total</td>
                    <td className="py-1.5 text-right">{report.days.reduce((sum, day) => sum + day.orders, 0)}</td>
                    <td className="py-1.5 text-right">{money(report.sales.total)}</td>
                    <td className="py-1.5 text-right">{money(report.tips)}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
          {report.topProducts.length > 0 ? (
            <Card className="[--card-spacing:--spacing(5)]">
              <CardHeader>
                <CardTitle>
                  <h3>Más vendidos</h3>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col divide-y text-sm">
                  {report.topProducts.map((product, index) => (
                    <li key={product.name} className="flex items-center gap-3 py-2">
                      <span className="w-5 text-muted-foreground tabular-nums">{index + 1}.</span>
                      <span className="min-w-0 flex-1 break-words">{product.name}</span>
                      <span className="text-muted-foreground tabular-nums">× {product.quantity}</span>
                      <span className="w-24 text-right font-medium tabular-nums">{money(product.total)}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Rechazados y cancelados no suman. Las propinas son del equipo y no forman parte de las ventas. Montos en pesos.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-card px-3 py-3 ring-1 ring-foreground/10" data-testid={testId}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}
