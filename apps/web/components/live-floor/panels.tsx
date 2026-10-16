"use client";

import { type LiveSummary, ORDER_CHANNEL_LABELS, ORDER_STATUS_LABELS, type OrderView, PAYMENT_METHOD_LABELS, type TableSessionView } from "@app/types";
import { BikeIcon, CheckIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RealtimeStatus } from "@/hooks/use-realtime";
import { formatClockTime } from "@/lib/format";
import {
  ALERT_COLORS,
  channelPlace,
  type ChipTone,
  inProgressBreakdown,
  kitchenGauge,
  type LiveModel,
  type LiveTarget,
  orderWho,
  type QueueTab,
  salesComparison,
  sparkline,
  statusSince,
  statusTone,
  TABLE_COLORS,
  TABLE_STATE_LABELS,
  tablesSummary,
  ticketTimer,
  timerLabel,
  trackingSteps,
} from "@/lib/live-floor";
import { formatAgo, type TrackedPosition } from "@/lib/maps";
import { formatPrice } from "@/lib/money";
import { focusOrderHref } from "@/lib/orders-board";
import { equalPartRows, paymentKindLabel, splitPlanLabel } from "@/lib/split-bill";
import { cn } from "@/lib/utils";

/** The mock-up's floating "glass" cards. */
export const GLASS =
  "rounded-[18px] border border-border/90 bg-card/90 shadow-[0_1px_2px_rgba(28,25,23,.04),0_14px_36px_-14px_rgba(28,25,23,.22)] backdrop-blur-md";

const CHIP_TONES: Record<ChipTone | "dark", string> = {
  ok: "bg-green-100 text-green-800",
  warn: "bg-amber-100 text-amber-800",
  pri: "bg-brand-soft text-brand-soft-foreground",
  neu: "border border-border bg-muted text-muted-foreground",
  rid: "bg-blue-100 text-blue-700",
  dark: "bg-foreground text-background",
};

export function Chip({ tone, children, className }: { tone: ChipTone | "dark"; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs leading-normal font-semibold whitespace-nowrap", CHIP_TONES[tone], className)}>
      {children}
    </span>
  );
}

const clock = (iso: string | null | undefined) => (iso ? formatClockTime(iso) : "—");

// ── Legend and connection ───────────────────────────────────────────────────

/** States of the tables, as the scene paints them. Only with a dining room. */
export function TableLegend({ className }: { className?: string }) {
  const swatch = "size-3 rounded-[4px] border border-foreground/10";
  return (
    <ul className={cn("flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground", className)} aria-label="Estados de las mesas">
      <li className="flex items-center gap-1.5">
        <span className={swatch} style={{ background: TABLE_COLORS.free.top }} aria-hidden />
        {TABLE_STATE_LABELS.free}
      </li>
      <li className="flex items-center gap-1.5">
        <span className={swatch} style={{ background: TABLE_COLORS.kitchen.top }} aria-hidden />
        {TABLE_STATE_LABELS.kitchen}
      </li>
      <li className="flex items-center gap-1.5">
        <span className={swatch} style={{ background: TABLE_COLORS.eating.top }} aria-hidden />
        {TABLE_STATE_LABELS.eating}
      </li>
      <li className="flex items-center gap-1.5">
        <span className={cn(swatch, "-rotate-45 rounded-[50%_50%_50%_0]")} style={{ background: ALERT_COLORS.waiter }} aria-hidden />
        {TABLE_STATE_LABELS.waiter}
      </li>
      <li className="flex items-center gap-1.5">
        <span className={cn(swatch, "-rotate-45 rounded-[50%_50%_50%_0]")} style={{ background: ALERT_COLORS.bill }} aria-hidden />
        {TABLE_STATE_LABELS.bill}
      </li>
      <li className="flex items-center gap-1.5">
        <span className={cn(swatch, "rounded-full")} style={{ background: `conic-gradient(${ALERT_COLORS.paying} 0 33%, #e7e5e4 0)` }} aria-hidden />
        {TABLE_STATE_LABELS.paying}
      </li>
    </ul>
  );
}

const STATUS_TEXT: Record<RealtimeStatus, string> = {
  live: "En vivo",
  connecting: "Conectando…",
  offline: "Sin conexión · reintentando",
  denied: "Sin acceso en vivo",
};

/** "En vivo · 20:41" from the real socket state of the restaurant. */
export function LiveStatus({ status, now }: { status: RealtimeStatus; now: number }) {
  const live = status === "live";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold",
        live ? "bg-green-100 text-green-800" : status === "connecting" ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800",
      )}
      role="status"
      data-testid="live-status"
      data-status={status}
    >
      <span className={cn("size-2 rounded-full", live ? "animate-pulse bg-green-700 motion-reduce:animate-none" : status === "connecting" ? "bg-muted-foreground" : "bg-amber-600")} aria-hidden />
      {STATUS_TEXT[status]}
      {now > 0 ? (
        <>
          {" · "}
          <time className="text-foreground tabular-nums" dateTime={new Date(now).toISOString()}>
            {formatClockTime(new Date(now).toISOString())}
          </time>
        </>
      ) : null}
    </div>
  );
}

// ── Indicators ──────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, children, testId }: { label: string; value: ReactNode; sub: ReactNode; children?: ReactNode; testId: string }) {
  return (
    <div className={cn(GLASS, "flex min-w-0 flex-col gap-0.5 px-3.5 py-3")} data-testid={testId}>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="text-xl leading-tight font-bold tracking-tight tabular-nums sm:text-2xl">{value}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{sub}</span>
      {children ? <div className="mt-1.5 flex h-[30px] items-end">{children}</div> : null}
    </div>
  );
}

/**
 * Indicators on top of the scene: sales (sparkline, % vs last week), orders in progress per channel,
 * kitchen time against the goal and, with a dining room, occupied tables.
 */
export function KpiCards({
  summary,
  error,
  onRetry,
  model,
  timezone,
  className,
}: {
  summary: LiveSummary | null;
  error: unknown;
  onRetry(): void;
  model: LiveModel;
  timezone: string;
  className?: string;
}) {
  const showTables = model.layout.dining;
  const grid = cn("grid grid-cols-2 gap-3", showTables ? "lg:grid-cols-4" : "lg:grid-cols-3", className);
  if (!summary) {
    if (error) {
      return (
        <div className={cn(GLASS, "flex flex-wrap items-center justify-between gap-3 p-3", className)}>
          <FormError error={error} />
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon aria-hidden data-icon="inline-start" />
            Reintentar
          </Button>
        </div>
      );
    }
    return (
      <div className={grid} aria-busy="true" aria-label="Cargando indicadores">
        {Array.from({ length: showTables ? 4 : 3 }, (_, i) => (
          <Skeleton key={i} className="h-[106px] rounded-[18px]" />
        ))}
      </div>
    );
  }
  const { change, text } = salesComparison(summary, timezone);
  const spark = sparkline(summary.hourly, 150, 30);
  const breakdown = inProgressBreakdown(summary.inProgress, model.channels);
  const gauge = kitchenGauge(summary.kitchen);
  const tables = tablesSummary(summary.tables);
  const sparkId = "live-spark-gradient";
  return (
    <div className={grid} aria-label="Indicadores de hoy">
      <Kpi
        testId="kpi-sales"
        label="Ventas de hoy"
        value={formatPrice(summary.sales.total, summary.sales.currency)}
        sub={
          <>
            {change ? <span className={cn("font-bold", change.trend === "up" ? "text-green-700" : change.trend === "down" ? "text-red-700" : "")}>{change.text}</span> : null}
            {text}
          </>
        }
      >
        {spark ? (
          <svg viewBox="0 0 150 30" width="100%" height="30" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id={sparkId} x1={0} x2={0} y1={0} y2={1}>
                <stop offset={0} stopColor="#c2410c" stopOpacity={0.22} />
                <stop offset={1} stopColor="#c2410c" stopOpacity={0} />
              </linearGradient>
            </defs>
            <line x1={0} y1={29.5} x2={150} y2={29.5} stroke="#e7e5e4" />
            <path d={spark.area} fill={`url(#${sparkId})`} />
            <path d={spark.line} fill="none" stroke="#c2410c" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : null}
      </Kpi>
      <Kpi testId="kpi-orders" label="Pedidos en curso" value={summary.inProgress.total} sub={breakdown.text || "Sin pedidos en curso"}>
        <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          {breakdown.parts.map((part) => (part.count > 0 ? <span key={part.channel} className="h-full" style={{ flex: part.count, background: part.color }} /> : null))}
        </div>
      </Kpi>
      <Kpi
        testId="kpi-kitchen"
        label="Tiempo promedio de cocina"
        value={
          <>
            {gauge.value} <small className="text-sm font-semibold text-muted-foreground">min</small>
          </>
        }
        sub={<span className={cn(gauge.status === "over" && "font-semibold text-amber-700")}>{gauge.text}</span>}
      >
        <div className="relative h-2 w-full rounded-full border border-border bg-muted" aria-hidden>
          <i className={cn("absolute inset-y-0 left-0 rounded-full", gauge.status === "over" ? "bg-amber-600" : "bg-green-700")} style={{ width: `${gauge.fillPercent}%` }} />
          <b className="absolute -inset-y-1.5 w-0.5 rounded-sm bg-foreground" style={{ left: `${gauge.targetPercent}%` }} />
        </div>
      </Kpi>
      {showTables ? (
        <Kpi
          testId="kpi-tables"
          label="Mesas ocupadas"
          value={
            <>
              {summary.tables.occupied}
              <small className="text-sm font-semibold text-muted-foreground">/{summary.tables.positioned}</small>
            </>
          }
          sub={tables.text}
        >
          <div className="flex flex-wrap gap-1" aria-hidden>
            {tables.squares.map((on, i) => (
              <span key={i} className={cn("size-4 rounded-[5px] border", on ? "border-primary bg-primary" : "border-border bg-muted")} />
            ))}
          </div>
        </Kpi>
      ) : null}
    </div>
  );
}

// ── Detail panel ────────────────────────────────────────────────────────────

function Head({ eyebrow, title, meta, chip }: { eyebrow: string; title: string; meta: string; chip: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{eyebrow}</span>
      <h2 className="text-xl leading-tight font-bold tracking-tight" data-testid="live-detail-title">
        {title}
      </h2>
      <span className="text-[13px] text-muted-foreground">{meta}</span>
      <div>{chip}</div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex justify-between gap-2 text-xs font-bold text-muted-foreground">
        <span>{title}</span>
        {right ? <span>{right}</span> : null}
      </h3>
      {children}
    </section>
  );
}

interface Row {
  key: string;
  lead?: ReactNode;
  name: ReactNode;
  chip?: ReactNode;
  right?: ReactNode;
  onClick?(): void;
}

function Rows({ rows, empty, label }: { rows: Row[]; empty: string; label?: string }) {
  if (rows.length === 0) return <p className="text-[13px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col" aria-label={label}>
      {rows.map((row) => {
        const content = (
          <>
            {row.lead !== undefined ? <span className="min-w-[2.6em] text-muted-foreground tabular-nums">{row.lead}</span> : null}
            <span className="min-w-0 flex-1">{row.name}</span>
            {row.chip}
            {row.right !== undefined ? <span className="ml-auto font-semibold whitespace-nowrap tabular-nums">{row.right}</span> : null}
          </>
        );
        return (
          <li key={row.key} className="border-b border-border last:border-b-0">
            {row.onClick ? (
              <button type="button" className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-[7px] text-left text-[13px] hover:bg-muted" onClick={row.onClick}>
                {content}
              </button>
            ) : (
              <div className="flex min-w-0 items-center gap-2 py-[7px] text-[13px]">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-[13px]">
      {items.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{key}</dt>
          <dd className="m-0 min-w-0 text-right font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Callout({ warn, children }: { warn?: boolean; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-2 rounded-xl border px-3 py-2.5", warn ? "border-amber-200 bg-amber-50" : "border-border bg-muted/60")}>{children}</div>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 pt-1 xl:sticky xl:-bottom-4 xl:-mx-4 xl:-mb-4 xl:mt-auto xl:bg-gradient-to-b xl:from-transparent xl:to-card xl:to-[14px] xl:px-4 xl:pt-3 xl:pb-4">{children}</div>;
}

function Check({ done }: { done: boolean }) {
  return done ? (
    <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-green-700 text-white">
      <CheckIcon className="size-3" strokeWidth={3.6} aria-hidden />
    </span>
  ) : (
    <span className="size-[18px] shrink-0 rounded-full border-[1.5px] border-dashed border-border bg-card" />
  );
}

export interface DetailContext {
  model: LiveModel;
  summary: LiveSummary | null;
  restaurantId: string;
  now: number;
  positions: ReadonlyMap<string, TrackedPosition>;
  onSelect(target: LiveTarget): void;
}

function paymentLine(order: OrderView): ReactNode {
  if (order.paymentStatus === "paid") return <Chip tone="ok">Pagado</Chip>;
  return <Chip tone="warn">Por pagar {formatPrice(order.total, order.currency)}</Chip>;
}

function orderRows(orders: readonly OrderView[], ctx: DetailContext, describe: (order: OrderView) => ReactNode): Row[] {
  return orders.map((order) => {
    const timer = ticketTimer(order, ctx.now, ctx.model.kitchenTarget);
    return {
      key: order.id,
      lead: `#${order.ticketNumber}`,
      name: describe(order),
      chip: (
        <Chip tone={timer.late && order.status !== "out_for_delivery" ? "warn" : statusTone(order.status)}>
          {ORDER_STATUS_LABELS[order.status]} · {timerLabel(timer.minutes)}
        </Chip>
      ),
      onClick: () => ctx.onSelect({ kind: "order", id: order.id }),
    };
  });
}

function TableDetail({ tableId, ctx }: { tableId: string; ctx: DetailContext }) {
  const { model, restaurantId, now } = ctx;
  const table = model.layout.tables.find((t) => t.id === tableId);
  if (!table) return null;
  const state = model.tableStates.get(tableId);
  const session: TableSessionView | null = state?.session ?? null;
  const indicator = state?.indicator ?? "free";
  const salon = `/admin/${restaurantId}/salon`;
  const shape = `${table.layout.shape === "round" ? "Redonda" : "Cuadrada"} · ${table.layout.seats} puestos`;
  // With more than one floor the eyebrow says which one («Mesa · Terraza»).
  const place = model.floors.length > 1 ? (model.floors[table.layout.floor]?.name ?? "Salón") : "Salón";
  if (!session) {
    return (
      <>
        <Head eyebrow={`Mesa · ${place}`} title={table.label} meta={shape} chip={<Chip tone="neu">Libre</Chip>} />
        <Callout>
          <strong className="text-sm">Sin cuenta abierta</strong>
          <span className="text-[13px] text-muted-foreground">El próximo pedido desde el QR de la mesa abre una cuenta nueva.</span>
        </Callout>
        <Actions>
          <Button asChild variant="outline" className="flex-1">
            <Link href={salon}>Ir a Salón</Link>
          </Button>
        </Actions>
      </>
    );
  }
  const active = model.orders.filter((order) => order.tableSessionId === session.id);
  // «Ver en Pedidos» opens the oldest one in progress: the one the kitchen is working on first.
  const oldest = active.reduce<(typeof active)[number] | undefined>((first, o) => (!first || o.createdAt < first.createdAt ? o : first), undefined);
  const tone: ChipTone = indicator === "waiter" ? "warn" : indicator === "bill" || indicator === "kitchen" ? "pri" : indicator === "free" ? "neu" : "ok";
  const ago = state?.since && (indicator === "waiter" || indicator === "bill") ? ` · ${formatAgo(now - Date.parse(state.since))}` : "";
  const rows = equalPartRows(session);
  const total = session.paid + session.remaining;
  const plan = splitPlanLabel(session.split, session.equalPart, session.currency);
  const charging = state?.bill || state?.paying;
  return (
    <>
      <Head
        eyebrow={`Mesa · ${place}`}
        title={table.label}
        meta={`${shape} · desde las ${clock(session.openedAt)}`}
        chip={
          <Chip tone={tone}>
            {TABLE_STATE_LABELS[indicator]}
            {ago}
          </Chip>
        }
      />
      {state?.waiter ? (
        <Callout warn>
          <strong className="text-sm">Llamó al garzón a las {clock(session.waiterCalledAt)}</strong>
          <span className="text-[13px] text-muted-foreground">El llamado se marca como atendido en Salón.</span>
        </Callout>
      ) : null}
      {state?.bill ? (
        <Callout>
          <strong className="text-sm">Pidió la cuenta a las {clock(session.billRequestedAt)}</strong>
          <KeyValues
            items={[
              ["Consumo", formatPrice(session.subtotal, session.currency)],
              [session.requestedTip !== null ? "Propina elegida" : `Propina sugerida (${session.tipPercent} %)`, formatPrice(session.requestedTip ?? session.suggestedTip, session.currency)],
              ["Total con propina", formatPrice(session.subtotal + (session.requestedTip ?? session.suggestedTip), session.currency)],
            ]}
          />
          <span className="text-xs text-muted-foreground">La propina es voluntaria y se confirma al cobrar.</span>
        </Callout>
      ) : null}
      {state?.paying ? (
        <Callout>
          <strong className="text-sm">{plan ?? "Pagando por partes"}</strong>
          <Rows
            empty=""
            rows={
              rows.length > 0
                ? rows.map((row) => ({
                    key: `part-${row.part}`,
                    lead: <Check done={row.status === "paid"} />,
                    name: row.status === "paid" ? `Parte ${row.part} · ${PAYMENT_METHOD_LABELS[row.payment.method]}` : `Parte ${row.part} · Pendiente`,
                    right: formatPrice(row.status === "paid" ? row.payment.amount : row.amount, session.currency),
                  }))
                : session.payments.map((payment) => ({
                    key: payment.id,
                    lead: <Check done />,
                    name: `${paymentKindLabel(payment)} · ${PAYMENT_METHOD_LABELS[payment.method]}`,
                    right: formatPrice(payment.amount, session.currency),
                  }))
            }
          />
          <div className="h-2.5 overflow-hidden rounded-full border border-border bg-muted" role="img" aria-label={`Pagado ${formatPrice(session.paid, session.currency)} de ${formatPrice(total, session.currency)}`}>
            <i className="block h-full rounded-full bg-green-700" style={{ width: `${total > 0 ? Math.min(100, (session.paid / total) * 100) : 100}%` }} />
          </div>
          <div className="flex justify-between gap-2 text-[13px]">
            <span>
              Pagado <b className="tabular-nums">{formatPrice(session.paid, session.currency)}</b>
            </span>
            <span>
              Falta <b className="tabular-nums">{formatPrice(session.remaining, session.currency)}</b>
            </span>
          </div>
        </Callout>
      ) : null}
      {active.length > 0 ? (
        <Section title="Pedidos en curso">
          <Rows empty="" rows={orderRows(active, ctx, (order) => order.items.map((item) => `${item.quantity} × ${item.name}`).join(", "))} />
        </Section>
      ) : null}
      <Section title="Consumo de la mesa" right={`Total ${formatPrice(session.subtotal, session.currency)}`}>
        <Rows
          empty="Todavía sin pedidos."
          rows={session.lines.map((line, index) => ({
            key: `${line.name}-${index}`,
            lead: `${line.quantity} ×`,
            name: (
              <>
                {line.name}
                {line.options.length > 0 ? <span className="text-muted-foreground"> ({line.options.join(", ")})</span> : null}
              </>
            ),
            right: formatPrice(line.total, session.currency),
          }))}
        />
      </Section>
      <Actions>
        <Button asChild className="flex-1">
          <Link href={salon}>{charging ? "Cobrar" : "Ir a Salón"}</Link>
        </Button>
        {oldest ? (
          <Button asChild variant="outline">
            <Link href={focusOrderHref(restaurantId, oldest.id)}>Ver en Pedidos</Link>
          </Button>
        ) : null}
      </Actions>
    </>
  );
}

function KitchenDetail({ ctx }: { ctx: DetailContext }) {
  const { model, summary, restaurantId } = ctx;
  const count = model.groups.reduce((sum, g) => sum + g.tickets.length, 0);
  const gauge = summary ? kitchenGauge(summary.kitchen) : null;
  return (
    <>
      <Head
        eyebrow="Zona"
        title="Cocina"
        meta={`${count} ${count === 1 ? "comanda" : "comandas"}${gauge && gauge.status !== "none" ? ` · promedio ${gauge.value} min (meta ${model.kitchenTarget})` : ` · meta ${model.kitchenTarget} min`}`}
        chip={
          gauge?.status === "over" ? <Chip tone="warn">Sobre la meta</Chip> : gauge?.status === "ok" ? <Chip tone="ok">Dentro de la meta</Chip> : <Chip tone="neu">Sin pedidos listos hoy</Chip>
        }
      />
      {model.groups.map((group) => (
        <Section key={group.key} title={group.label} right={String(group.tickets.length)}>
          <Rows
            empty="Ninguna."
            rows={group.tickets.map(({ order, minutes, late }) => ({
              key: order.id,
              lead: `#${order.ticketNumber}`,
              name: `${channelPlace(order)} · ${orderWho(order)}`,
              chip: <Chip tone={late ? "warn" : statusTone(order.status)}>{timerLabel(minutes)}</Chip>,
              onClick: () => ctx.onSelect({ kind: "order", id: order.id }),
            }))}
          />
        </Section>
      ))}
      <Actions>
        <Button asChild className="flex-1">
          <Link href={`/admin/${restaurantId}/pedidos`}>Abrir Pedidos</Link>
        </Button>
      </Actions>
    </>
  );
}

function PickupDetail({ ctx }: { ctx: DetailContext }) {
  const { model, restaurantId } = ctx;
  const waiting = model.pickupQueue.filter((order) => order.status !== "ready");
  return (
    <>
      <Head
        eyebrow="Zona"
        title="Mesón de retiro"
        meta={`${model.readyPickups.length} ${model.readyPickups.length === 1 ? "listo" : "listos"} · ${waiting.length} en cocina`}
        chip={model.readyPickups.length > 0 ? <Chip tone="ok">{model.readyPickups.length} por entregar</Chip> : <Chip tone="neu">Nada por entregar</Chip>}
      />
      <Section title="Por retirar">
        <Rows
          empty="No hay pedidos esperando en el mesón."
          rows={model.readyPickups.map((order) => ({
            key: order.id,
            lead: `#${order.ticketNumber}`,
            name: `${order.customerName} · listo ${clock(statusSince(order))}`,
            chip: paymentLine(order),
            onClick: () => ctx.onSelect({ kind: "order", id: order.id }),
          }))}
        />
      </Section>
      <Section title="En cocina">
        <Rows empty="Ninguno." rows={orderRows(waiting, ctx, (order) => `${order.customerName}${order.estimatedReadyAt ? ` · aprox. ${clock(order.estimatedReadyAt)}` : ""}`)} />
      </Section>
      <Actions>
        <Button asChild className="flex-1">
          <Link href={`/admin/${restaurantId}/pedidos`}>Ver en Pedidos</Link>
        </Button>
      </Actions>
    </>
  );
}

function DoorDetail({ ctx }: { ctx: DetailContext }) {
  const { model, restaurantId } = ctx;
  const leaving = model.deliveryQueue.filter((order) => order.status === "ready");
  return (
    <>
      <Head
        eyebrow="Zona"
        title="Puerta de delivery"
        meta={`${model.onTheWay.length} en reparto · ${leaving.length} por salir`}
        chip={<Chip tone="rid">{model.onTheWay.length} en ruta</Chip>}
      />
      <Section title="En reparto">
        <Rows
          empty="Ningún reparto en camino."
          rows={model.onTheWay.map((order) => ({
            key: order.id,
            lead: `#${order.ticketNumber}`,
            name: `${order.rider?.name ?? "Sin repartidor"} · ${order.delivery?.address ?? ""}`,
            chip: <Chip tone="rid">{order.estimatedReadyAt ? `Llega ${clock(order.estimatedReadyAt)}` : "En reparto"}</Chip>,
            onClick: () => ctx.onSelect({ kind: "order", id: order.id }),
          }))}
        />
      </Section>
      <Section title="Listos para salir">
        <Rows
          empty="Ninguno."
          rows={leaving.map((order) => ({
            key: order.id,
            lead: `#${order.ticketNumber}`,
            name: `${order.customerName} · ${order.delivery?.zoneName ?? ""}`,
            chip: <Chip tone={order.rider ? "rid" : "warn"}>{order.rider ? order.rider.name : "Sin repartidor"}</Chip>,
            onClick: () => ctx.onSelect({ kind: "order", id: order.id }),
          }))}
        />
      </Section>
      <Actions>
        <Button asChild className="flex-1">
          <Link href={`/admin/${restaurantId}/pedidos`}>Ver en Pedidos</Link>
        </Button>
      </Actions>
    </>
  );
}

function OrderDetail({ orderId, ctx }: { orderId: string; ctx: DetailContext }) {
  const { model, restaurantId, now, positions } = ctx;
  const order = model.orders.find((o) => o.id === orderId);
  if (!order) return null;
  const timer = ticketTimer(order, now, model.kitchenTarget);
  const out = order.status === "out_for_delivery";
  const position = positions.get(order.id);
  const eyebrow = out ? "Repartidor" : `Pedido · ${ORDER_CHANNEL_LABELS[order.channel]}`;
  const title = out ? (order.rider?.name ?? "Reparto del local") : `Pedido #${order.ticketNumber}`;
  const meta = out ? `Pedido #${order.ticketNumber} · ${order.customerName}` : `${channelPlace(order)} · ${orderWho(order)} · ${clock(order.createdAt)}`;
  const expected = order.expectedPayment;
  return (
    <>
      <Head
        eyebrow={eyebrow}
        title={title}
        meta={meta}
        chip={
          <Chip tone={timer.late && !out ? "warn" : statusTone(order.status)}>
            {ORDER_STATUS_LABELS[order.status]} · {timerLabel(timer.minutes)}
          </Chip>
        }
      />
      {order.channel === "delivery" ? (
        <Section title="Ruta">
          <KeyValues
            items={[
              ...(out ? ([["Salió", clock(statusSince(order))]] as [string, ReactNode][]) : []),
              ["Llega aprox.", clock(order.estimatedReadyAt)],
              ["Destino", [order.delivery?.address, order.delivery?.unit].filter(Boolean).join(", ") || "—"],
              ["Zona", order.delivery?.zoneName ?? "—"],
              ...(out ? ([["Última ubicación", position && now > 0 ? formatAgo(now - position.seenAt) : "Sin ubicación todavía"]] as [string, ReactNode][]) : []),
            ]}
          />
        </Section>
      ) : order.channel === "pickup" ? (
        <Section title="Retiro">
          <KeyValues items={[["Cliente", order.customerName], ["Listo aprox.", clock(order.estimatedReadyAt)]]} />
        </Section>
      ) : null}
      <Section title="Cobro">
        <KeyValues
          items={[
            ["Total", formatPrice(order.total, order.currency)],
            ...(order.paymentStatus === "paid"
              ? ([["Pago", order.paymentMethod ? `Pagado · ${PAYMENT_METHOD_LABELS[order.paymentMethod]}` : "Pagado"]] as [string, ReactNode][])
              : expected
                ? ([
                    ["Paga con", PAYMENT_METHOD_LABELS[expected.method]],
                    ...(expected.cashAmount !== null ? ([["Billete", formatPrice(expected.cashAmount, order.currency)]] as [string, ReactNode][]) : []),
                    ...(expected.change !== null ? ([["Lleva vuelto", formatPrice(expected.change, order.currency)]] as [string, ReactNode][]) : []),
                  ] as [string, ReactNode][])
                : ([["Pago", "Pendiente"]] as [string, ReactNode][])),
          ]}
        />
      </Section>
      <Section title="Pedido">
        <Rows
          empty=""
          rows={[
            ...order.items.map((item, index) => ({
              key: `${item.name}-${index}`,
              lead: `${item.quantity} ×`,
              name: item.name,
              right: formatPrice(item.lineTotal, order.currency),
            })),
            ...(order.deliveryFee > 0 ? [{ key: "fee", lead: "", name: "Despacho", right: formatPrice(order.deliveryFee, order.currency) }] : []),
          ]}
        />
      </Section>
      <Actions>
        <Button asChild className="flex-1">
          <Link href={focusOrderHref(restaurantId, order.id)}>Ver en Pedidos</Link>
        </Button>
        {order.channel === "dine_in" ? (
          <Button asChild variant="outline">
            <Link href={`/admin/${restaurantId}/salon`}>Ir a Salón</Link>
          </Button>
        ) : null}
      </Actions>
    </>
  );
}

/** Right-hand panel: what was clicked in the scene (a table, the kitchen, the counter, the door, an order). */
export function DetailPanel({ target, ctx, className }: { target: LiveTarget; ctx: DetailContext; className?: string }) {
  let content: ReactNode;
  switch (target.kind) {
    case "table":
      content = <TableDetail tableId={target.id} ctx={ctx} />;
      break;
    case "pickup":
      content = <PickupDetail ctx={ctx} />;
      break;
    case "door":
      content = <DoorDetail ctx={ctx} />;
      break;
    case "order":
      content = <OrderDetail orderId={target.id} ctx={ctx} />;
      break;
    default:
      content = <KitchenDetail ctx={ctx} />;
  }
  return (
    <aside className={cn("flex min-w-0 flex-col gap-3.5 p-4", className)} aria-live="polite" aria-label="Detalle" data-testid="live-detail">
      {content}
    </aside>
  );
}

// ── Tracking strip ──────────────────────────────────────────────────────────

/** The steps of one order (the selected one, else the featured one), with its rider when it is on its way. */
export function TrackingStrip({
  order,
  ctx,
  className,
}: {
  order: OrderView | null;
  ctx: Pick<DetailContext, "onSelect" | "positions" | "now">;
  className?: string;
}) {
  if (!order) {
    return (
      <section className={cn(GLASS, "flex items-center gap-3 px-4 py-3.5 text-sm text-muted-foreground", className)} aria-label="Seguimiento del pedido">
        <h2 className="text-sm font-semibold text-foreground">Seguimiento del pedido</h2>
        Sin pedidos en curso.
      </section>
    );
  }
  const steps = trackingSteps(order);
  const out = order.status === "out_for_delivery";
  const position = ctx.positions.get(order.id);
  return (
    <section
      className={cn(GLASS, "grid grid-cols-1 items-center gap-x-4.5 gap-y-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto]", className)}
      aria-label={`Seguimiento del pedido ${order.ticketNumber}`}
      data-testid="live-tracking"
    >
      <div className="col-span-full flex flex-wrap items-center gap-2.5">
        <h2 className="text-sm font-semibold">Seguimiento del pedido</h2>
        <span className="text-[13px] text-muted-foreground">
          #{order.ticketNumber} · {channelPlace(order)}
          {order.customerName ? ` · ${order.customerName}` : ""}
        </span>
        <Chip tone={statusTone(order.status)}>{ORDER_STATUS_LABELS[order.status]}</Chip>
      </div>
      <div className="min-w-0 overflow-x-auto pb-0.5">
        <ol className="grid min-w-[440px]" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(76px, 1fr))` }}>
          {steps.map((step, index) => (
            <li
              key={step.status}
              className="relative flex flex-col items-center gap-1 text-center text-xs text-muted-foreground"
              aria-current={step.state === "current" ? "step" : undefined}
            >
              {index > 0 ? (
                <span className={cn("absolute top-[11px] right-1/2 -left-1/2 h-[3px]", step.state === "todo" ? "bg-border" : "bg-primary")} aria-hidden />
              ) : null}
              <span
                className={cn(
                  "relative z-[1] grid place-items-center rounded-full border-2",
                  step.state === "done" && "size-6 border-primary bg-primary text-primary-foreground",
                  step.state === "current" && "-mt-0.5 size-7 border-[3px] border-primary bg-card text-primary shadow-[0_0_0_5px_rgba(194,65,12,.15)]",
                  step.state === "todo" && "size-6 border-border bg-card",
                )}
                aria-hidden
              >
                {step.state === "done" ? <CheckIcon className="size-3" strokeWidth={3.4} /> : step.state === "current" ? <span className="size-2 rounded-full bg-primary" /> : null}
              </span>
              <strong className={cn("text-[12.5px]", step.state === "current" ? "text-brand-soft-foreground" : step.state === "todo" ? "font-semibold text-muted-foreground" : "text-foreground")}>
                {step.label}
              </strong>
              <time className="tabular-nums">{step.at ? `${step.estimated ? "~" : ""}${clock(step.at)}` : ""}</time>
            </li>
          ))}
        </ol>
      </div>
      {out ? (
        <button
          type="button"
          className="flex min-w-0 items-center gap-2.5 rounded-[14px] border border-border bg-card px-3 py-2 text-left hover:border-primary/40"
          onClick={() => ctx.onSelect({ kind: "order", id: order.id })}
        >
          <span className="grid size-[38px] shrink-0 place-items-center rounded-[11px] bg-blue-100 text-blue-700">
            <BikeIcon className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-[13px]">
              {order.rider?.name ?? "Reparto del local"}
              {order.estimatedReadyAt ? ` · llega ${clock(order.estimatedReadyAt)}` : ""}
            </strong>
            <span className="block truncate text-xs text-muted-foreground">
              {order.delivery?.address ?? ""}
              {position && ctx.now > 0 ? ` · ubicación ${formatAgo(ctx.now - position.seenAt)}` : ""}
            </span>
          </span>
        </button>
      ) : null}
    </section>
  );
}

// ── Work queue ──────────────────────────────────────────────────────────────

export const TAB_LABELS: Record<QueueTab, string> = { kitchen: "Cocina", pickup: "Retiro", delivery: "Repartos" };

export interface QueueRowData {
  key: string;
  number: string;
  title: string;
  subtitle: string;
  chip: { tone: ChipTone; text: string };
  target: LiveTarget;
}

/** Rows of one tab of the queue (also the zone lists of the phone view). */
export function queueRows(tab: QueueTab, model: LiveModel, now: number): QueueRowData[] {
  if (tab === "kitchen") {
    return model.groups.flatMap((group) =>
      group.tickets.map(({ order, minutes, late }) => ({
        key: order.id,
        number: `#${order.ticketNumber}`,
        title: `${channelPlace(order)} · ${orderWho(order)}`,
        subtitle: `${ORDER_STATUS_LABELS[order.status]} · ${timerLabel(minutes)}`,
        chip: { tone: late ? "warn" : statusTone(order.status), text: group.label },
        target: { kind: "order", id: order.id } as LiveTarget,
      })),
    );
  }
  if (tab === "pickup") {
    return model.pickupQueue.map((order) => {
      const ready = order.status === "ready";
      return {
        key: order.id,
        number: `#${order.ticketNumber}`,
        title: order.customerName || "Retiro",
        subtitle: ready
          ? `Listo desde ${clock(statusSince(order))} · ${order.paymentStatus === "paid" ? "pagado" : "por pagar"}`
          : `${ORDER_STATUS_LABELS[order.status]}${order.estimatedReadyAt ? ` · listo aprox. ${clock(order.estimatedReadyAt)}` : ""}`,
        chip: { tone: ready ? (order.paymentStatus === "paid" ? "ok" : "warn") : statusTone(order.status), text: ready ? "Listo" : ORDER_STATUS_LABELS[order.status] },
        target: { kind: "order", id: order.id } as LiveTarget,
      };
    });
  }
  return model.deliveryQueue.map((order) => {
    const out = order.status === "out_for_delivery";
    const timer = ticketTimer(order, now, model.kitchenTarget);
    return {
      key: order.id,
      number: `#${order.ticketNumber}`,
      title: `${order.rider?.name ?? order.customerName} · ${order.delivery?.address ?? ""}`,
      subtitle: out
        ? `${order.estimatedReadyAt ? `Llega ${clock(order.estimatedReadyAt)}` : "En camino"} · ${order.paymentStatus === "paid" ? "pagado" : order.expectedPayment ? `cobra ${PAYMENT_METHOD_LABELS[order.expectedPayment.method].toLowerCase()}` : "por cobrar"}`
        : order.status === "ready"
          ? order.rider
            ? `Listo · sale con ${order.rider.name}`
            : "Listo · esperando repartidor"
          : `${ORDER_STATUS_LABELS[order.status]} · ${timerLabel(timer.minutes)}`,
      chip: out ? { tone: "rid", text: "En reparto" } : order.status === "ready" ? { tone: order.rider ? "ok" : "warn", text: order.rider ? "Por salir" : "Asignar" } : { tone: statusTone(order.status), text: ORDER_STATUS_LABELS[order.status] },
      target: { kind: "order", id: order.id } as LiveTarget,
    };
  });
}

const EMPTY_TEXT: Record<QueueTab, string> = {
  kitchen: "Sin comandas en cocina.",
  pickup: "Sin pedidos para retirar.",
  delivery: "Sin repartos en curso.",
};

export function QueueList({ rows, tab, onSelect, label }: { rows: QueueRowData[]; tab: QueueTab; onSelect(target: LiveTarget): void; label?: string }) {
  if (rows.length === 0) return <p className="px-1 py-3 text-[13px] text-muted-foreground">{EMPTY_TEXT[tab]}</p>;
  return (
    <ul className="flex flex-col" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className="border-b border-border last:border-b-0">
          <button
            type="button"
            className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-lg px-1 py-2 text-left hover:bg-muted"
            onClick={() => onSelect(row.target)}
            data-testid="live-queue-row"
          >
            <span className="row-span-2 grid h-[34px] w-10 place-items-center rounded-lg bg-muted text-[12.5px] font-bold tabular-nums">{row.number}</span>
            <span className="truncate text-[13px] font-semibold">{row.title}</span>
            <span className="col-start-2 truncate text-xs text-muted-foreground">{row.subtitle}</span>
            <Chip tone={row.chip.tone} className="col-start-3 row-span-2 row-start-1">
              {row.chip.text}
            </Chip>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Work queue with tabs: Cocina, Retiro and Repartos (only the ones that apply). */
export function WorkQueue({ model, now, onSelect, className }: { model: LiveModel; now: number; onSelect(target: LiveTarget): void; className?: string }) {
  return (
    <section className={cn(GLASS, "flex min-w-0 flex-col gap-2 px-3.5 py-3", className)} aria-label="Cola de trabajo">
      <Tabs defaultValue="kitchen" className="min-h-0 flex-1 gap-2">
        <TabsList className="w-full">
          {model.tabs.map((tab) => (
            <TabsTrigger key={tab} value={tab} className="flex-1">
              {TAB_LABELS[tab]} ({queueRows(tab, model, now).length})
            </TabsTrigger>
          ))}
        </TabsList>
        {model.tabs.map((tab) => (
          <TabsContent key={tab} value={tab} className="min-h-0 overflow-y-auto">
            <QueueList rows={queueRows(tab, model, now)} tab={tab} onSelect={onSelect} />
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
