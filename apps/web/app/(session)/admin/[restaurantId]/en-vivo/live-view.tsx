"use client";

import { type FloorPlanView, type GeoArea, type LiveSummary, ORDER_STATUS_LABELS, type OrderView, type TableSessionView } from "@app/types";
import { MapIcon, PencilRulerIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/access-denied";
import { FormError } from "@/components/form-error";
import { CameraControls } from "@/components/live-floor/camera-controls";
import { LiveScene, type SceneData, type SceneTooltip } from "@/components/live-floor/live-scene";
import { DetailPanel, type DetailContext, GLASS, KpiCards, LiveStatus, TableLegend, TrackingStrip, WorkQueue } from "@/components/live-floor/panels";
import { RidersCard } from "@/components/live-floor/riders-card";
import { ZoneLists } from "@/components/live-floor/zone-lists";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useMapConfig } from "@/hooks/use-map-config";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useNow } from "@/hooks/use-now";
import { useSocketEvent } from "@/hooks/use-realtime";
import { localStore } from "@/lib/browser-storage";
import type { AppSocket } from "@/lib/realtime";
import { canViewSales } from "@/lib/daily-summary";
import { deliveryZonesApi, floorApi, liveApi, ordersApi, tableSessionsApi } from "@/lib/endpoints";
import { upsertSession } from "@/lib/floor";
import {
  type CameraTurns,
  channelPlace,
  KITCHEN_GROUPS,
  loadCameraTurns,
  type LiveModel,
  liveModel,
  type LiveTarget,
  orderWho,
  payingChip,
  resolveTarget,
  rotateLayout,
  saveCameraTurns,
  TABLE_STATE_LABELS,
  ticketTimer,
  timerLabel,
  turnCamera,
} from "@/lib/live-floor";
import { formatAgo, type TrackedPosition, trackPosition } from "@/lib/maps";
import { mergeFetched, upsertOrder } from "@/lib/orders-board";
import { cn } from "@/lib/utils";
import { useRestaurant } from "../restaurant-context";
import { useRestaurantRealtime } from "../restaurant-realtime";

/** Indicators refresh on their own every minute, and shortly after a burst of order or table events. */
const SUMMARY_INTERVAL_MS = 60_000;
const SUMMARY_DEBOUNCE_MS = 1_500;

/** «En vivo» (phase 9): owner and cashier, the same roles as «Ventas» (it shows today's sales). */
export function LiveView() {
  const { restaurant } = useRestaurant();
  if (!canViewSales(restaurant.myRoles)) {
    return <AccessDenied restaurantId={restaurant.id} title="Sin acceso" description="Solo dueños y caja pueden ver el local en vivo." />;
  }
  return <LiveFloor />;
}

// ── Data ────────────────────────────────────────────────────────────────────

/** The floor plan, replaced by `floor-plan.updated` when the owner saves it on another device. */
function useFloorPlan(restaurantId: string, socket: AppSocket | null, syncCount: number) {
  const [view, setView] = useState<FloorPlanView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setView(await floorApi.get(restaurantId, signal));
        setError(null);
      } catch (failure) {
        if (!signal?.aborted) setError(failure);
      }
    },
    [restaurantId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, syncCount]);
  useSocketEvent(socket, "floor-plan.updated", setView);
  return { view, error, reload: load };
}

/** Active orders, kept in sync like the board (a fetch never drops an order received meanwhile). */
function useActiveOrders(restaurantId: string, syncCount: number, onChange: () => void, socket: AppSocket | null) {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fetching = useRef<Set<string> | null>(null);
  const load = useCallback(async () => {
    const received = new Set<string>();
    fetching.current = received;
    try {
      const fetched = await ordersApi.list(restaurantId, "active");
      setOrders((current) => mergeFetched(current ?? [], fetched, true, received));
      setError(null);
    } catch (failure) {
      setError(failure);
    } finally {
      if (fetching.current === received) fetching.current = null;
    }
  }, [restaurantId]);
  useEffect(() => {
    void load();
  }, [load, syncCount]);
  const apply = (order: OrderView) => {
    fetching.current?.add(order.id);
    setOrders((current) => (current ? upsertOrder(current, order, true) : current));
    onChange();
  };
  useSocketEvent(socket, "order.created", apply);
  useSocketEvent(socket, "order.updated", apply);
  return { orders, error, reload: load };
}

/** Open table accounts (calls, bill requests, partial payments). */
function useOpenSessions(restaurantId: string, syncCount: number, onChange: () => void, socket: AppSocket | null) {
  const [sessions, setSessions] = useState<TableSessionView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setSessions(await tableSessionsApi.list(restaurantId));
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [restaurantId]);
  useEffect(() => {
    void load();
  }, [load, syncCount]);
  useSocketEvent(socket, "table.updated", (update) => {
    setSessions((current) => (current ? upsertSession(current, update) : current));
    onChange();
  });
  return { sessions, error, reload: load };
}

/** The indicators: every minute, after reconnecting, and debounced after live changes. */
function useLiveSummary(restaurantId: string, syncCount: number) {
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setSummary(await liveApi.summary(restaurantId));
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [restaurantId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), SUMMARY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load, syncCount]);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bump = useCallback(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(), SUMMARY_DEBOUNCE_MS);
  }, [load]);
  useEffect(() => () => clearTimeout(debounce.current), []);
  return { summary, error, reload: load, bump };
}

/** Last known position of each rider on the way: REST on load/reconnect, then `order.rider-location`. */
function useRiderPositions(restaurantId: string, onTheWay: readonly OrderView[], socket: AppSocket | null, syncCount: number) {
  const [positions, setPositions] = useState<ReadonlyMap<string, TrackedPosition>>(new Map());
  const keep = useCallback((orderId: string, incoming: TrackedPosition) => {
    setPositions((current) => {
      const known = current.get(orderId);
      if (known && known.at > incoming.at) return current;
      return new Map(current).set(orderId, incoming);
    });
  }, []);
  const ids = onTheWay.map((order) => order.id).join(",");
  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    for (const orderId of ids.split(",")) {
      ordersApi.riderLocation(restaurantId, orderId, controller.signal).then(
        ({ position }) => {
          if (position) keep(orderId, trackPosition(position, Date.now(), false));
        },
        // No position yet (or the request failed): the detail says "Sin ubicación todavía" and events fill it in.
        () => undefined,
      );
    }
    return () => controller.abort();
  }, [restaurantId, ids, syncCount, keep]);
  useSocketEvent(socket, "order.rider-location", (payload) => keep(payload.orderId, trackPosition(payload, Date.now(), true)));
  // Positions of deliveries no longer on the way are not shown (the api deletes them too).
  return useMemo(() => {
    const live = new Set(ids.split(","));
    return new Map([...positions].filter(([orderId]) => live.has(orderId)));
  }, [positions, ids]);
}

/** Areas of the active delivery zones, for the riders map (only when there is a map to draw them on). */
function useZoneAreas(restaurantId: string, enabled: boolean) {
  const [zones, setZones] = useState<{ id: string; area: GeoArea }[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    deliveryZonesApi.list(restaurantId).then(
      (list) => current && setZones(list.flatMap((zone) => (zone.active && zone.area ? [{ id: zone.id, area: zone.area }] : []))),
      // The map still shows the riders without the zones.
      () => current && setZones([]),
    );
    return () => {
      current = false;
    };
  }, [restaurantId, enabled]);
  return zones;
}

// ── View ────────────────────────────────────────────────────────────────────

/** "viernes, 20:41" in the restaurant's time zone. */
function dayAndTime(now: number, timeZone: string): string {
  if (now === 0) return "";
  const options = { weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  try {
    return new Intl.DateTimeFormat("es-CL", { ...options, timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("es-CL", options).format(now);
  }
}

/**
 * The camera of the scene: quarter turns remembered per device and restaurant (`mm:live-camera:<id>`), turned
 * with the buttons or the «[» / «]» keys while the scene is shown (never while typing, in a dialog or with a
 * modifier).
 */
function useCamera(restaurantId: string, sceneShown: boolean) {
  const [turns, setTurns] = useState<CameraTurns>(() => loadCameraTurns(localStore(), restaurantId));
  const turn = useCallback(
    (delta: -1 | 1) =>
      setTurns((current) => {
        const next = turnCamera(current, delta);
        saveCameraTurns(localStore(), restaurantId, next);
        return next;
      }),
    [restaurantId],
  );
  useEffect(() => {
    if (!sceneShown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" && event.key !== "]") return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog']")) return;
      event.preventDefault();
      turn(event.key === "[" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sceneShown, turn]);
  return { turns, turn };
}

/** Order the ring on the floor follows: a moto on its way, its bag on the counter, its table, or the kitchen. */
function ringOf(target: LiveTarget, model: LiveModel): LiveTarget {
  if (target.kind !== "order") return target;
  const order = model.orders.find((o) => o.id === target.id);
  if (!order) return { kind: "kitchen" };
  if (order.status === "out_for_delivery") return target;
  if (order.channel === "pickup" && order.status === "ready" && model.layout.pickup) return { kind: "pickup" };
  if (order.channel === "dine_in" && order.status === "ready" && order.tableSessionId) {
    const tableId = model.tableOfSession.get(order.tableSessionId);
    if (tableId && model.layout.tables.some((t) => t.id === tableId)) return { kind: "table", id: tableId };
  }
  return { kind: "kitchen" };
}

function LiveFloor() {
  const { restaurant, isOwner } = useRestaurant();
  const { socket, status, syncCount } = useRestaurantRealtime();
  const wide = useMediaQuery("(min-width: 1024px)");
  const now = useNow(15_000);
  const summary = useLiveSummary(restaurant.id, syncCount);
  const floor = useFloorPlan(restaurant.id, socket, syncCount);
  const active = useActiveOrders(restaurant.id, syncCount, summary.bump, socket);
  const open = useOpenSessions(restaurant.id, syncCount, summary.bump, socket);
  const map = useMapConfig();
  const [selected, setSelected] = useState<LiveTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const camera = useCamera(restaurant.id, wide || showPlan);

  const ready = floor.view !== null && active.orders !== null && open.sessions !== null;
  const model = useMemo(
    () =>
      ready
        ? liveModel({
            view: floor.view,
            restaurant,
            orders: active.orders ?? [],
            sessions: open.sessions ?? [],
            now,
          })
        : null,
    [ready, floor.view, restaurant, active.orders, open.sessions, now],
  );
  const positions = useRiderPositions(restaurant.id, model?.onTheWay ?? [], socket, syncCount);
  const zones = useZoneAreas(restaurant.id, Boolean(model?.layout.delivery) && map.available);

  const target = model ? resolveTarget(selected, model.layout, model.orders) : ({ kind: "kitchen" } as LiveTarget);
  const sceneData = useMemo<SceneData | null>(
    () =>
      model
        ? {
            // Only the scene sees the turned plan; panels, lists and selection work with ids.
            layout: rotateLayout(model.layout, camera.turns),
            restaurantName: restaurant.name,
            tableStates: model.tableStates,
            groups: model.groups,
            readyPickups: model.readyPickups,
            riders: model.onTheWay,
            ring: wide ? ringOf(target, model) : null,
          }
        : null,
    // The ring depends on the target's key only (a new object every render would redraw the scene).
    [model, restaurant.name, wide, camera.turns, target.kind, "id" in target ? target.id : ""],
  );

  if (!model || !sceneData) {
    const error = floor.error ?? active.error ?? open.error;
    if (error) {
      return (
        <div className="flex flex-col items-start gap-3">
          <FormError error={error} />
          <Button
            variant="outline"
            onClick={() => {
              void floor.reload();
              void active.reload();
              void open.reload();
              void summary.reload();
            }}
          >
            Reintentar
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando vista en vivo">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[106px] rounded-[18px]" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-3xl" />
      </div>
    );
  }

  function select(next: LiveTarget) {
    setSelected(next);
    if (!wide) setSheetOpen(true);
  }

  const describe = (t: LiveTarget): SceneTooltip | null => {
    switch (t.kind) {
      case "table": {
        const table = model.layout.tables.find((x) => x.id === t.id);
        if (!table) return null;
        const state = model.tableStates.get(t.id);
        const indicator = state?.indicator ?? "free";
        const since = state?.since && now > 0 && indicator !== "free" ? ` · ${formatAgo(now - Date.parse(state.since))}` : "";
        const extra = state?.session && indicator === "paying" ? payingChip(state.session) : null;
        return {
          title: table.label,
          text: indicator === "free" ? `Libre · ${table.layout.seats} puestos` : `${TABLE_STATE_LABELS[indicator]}${extra ? ` · ${extra}` : since}`,
        };
      }
      case "kitchen": {
        const count = model.groups.reduce((sum, g) => sum + g.tickets.length, 0);
        return { title: "Cocina", text: `${count} ${count === 1 ? "comanda" : "comandas"} · meta ${model.kitchenTarget} min` };
      }
      case "pickup":
        return { title: "Mesón de retiro", text: `${model.readyPickups.length} listos para entregar` };
      case "door":
        return { title: "Puerta de delivery", text: `${model.onTheWay.length} en reparto` };
      case "order": {
        const order = model.orders.find((o) => o.id === t.id);
        if (!order) return null;
        const timer = ticketTimer(order, now, model.kitchenTarget);
        return {
          title: order.status === "out_for_delivery" ? (order.rider?.name ?? `Reparto #${order.ticketNumber}`) : `Pedido #${order.ticketNumber}`,
          text: `${channelPlace(order)} · ${orderWho(order)} · ${ORDER_STATUS_LABELS[order.status]} ${timerLabel(timer.minutes)}`,
        };
      }
    }
  };

  const ctx: DetailContext = { model, summary: summary.summary, restaurantId: restaurant.id, now, positions, onSelect: select };
  const tracked = target.kind === "order" ? (model.orders.find((o) => o.id === target.id) ?? model.featured) : model.featured;
  const planHref = `/admin/${restaurant.id}/mesas/plano`;
  const sceneLabel = `Plano en vivo de ${restaurant.name}: cocina${model.layout.dining ? `, salón con ${model.layout.tables.length} mesas` : ""}${model.layout.pickup ? ", mesón de retiro" : ""}${model.layout.delivery ? ", puerta de delivery" : ""}`;
  const ridersCard = (className?: string) =>
    model.layout.delivery ? (
      <RidersCard
        model={model}
        now={now}
        positions={positions}
        map={map}
        zones={zones}
        center={restaurant.location}
        onSelect={select}
        className={className}
      />
    ) : null;

  const notice = !model.layout.hasPlan ? (
    <p className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-primary/40 bg-brand-soft px-3 py-2 text-sm text-brand-soft-foreground" data-testid="live-plan-notice">
      <PencilRulerIcon className="size-4 shrink-0" aria-hidden />
      {isOwner ? (
        <Link href={planHref} className="font-semibold underline underline-offset-4">
          Dibuja el plano de tu local para ver tus mesas
        </Link>
      ) : (
        <span>Cuando el dueño dibuje el plano del local, aquí verás las mesas.</span>
      )}
    </p>
  ) : !model.layout.dining ? (
    <p className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-sm text-muted-foreground" data-testid="live-tables-notice">
      <PencilRulerIcon className="size-4 shrink-0" aria-hidden />
      {isOwner ? (
        <Link href={planHref} className="font-semibold text-foreground underline underline-offset-4">
          Ubica tus mesas en el plano para verlas aquí
        </Link>
      ) : (
        <span>El plano todavía no tiene mesas ubicadas.</span>
      )}
    </p>
  ) : null;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold tracking-tight">Vista en vivo del local</h2>
        <p className="text-sm text-muted-foreground first-letter:uppercase">
          {dayAndTime(now, restaurant.timezone)}
          {now > 0 ? ". " : ""}
          {wide ? "Toca una mesa, la cocina, el mesón de retiro o un repartidor para ver su detalle." : "Toca una mesa o un pedido para ver su detalle."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {wide && model.layout.dining ? <TableLegend /> : null}
        {wide ? <CameraControls turns={camera.turns} onTurn={camera.turn} /> : null}
        {/* The plan can be changed as often as needed: without a plan the notice below links to the editor. */}
        {isOwner && model.layout.hasPlan ? (
          <Link href={planHref} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid="edit-floor-plan">
            <PencilRulerIcon aria-hidden data-icon="inline-start" />
            Editar plano
          </Link>
        ) : null}
        <LiveStatus status={status} now={now} />
      </div>
    </div>
  );

  if (!wide) {
    return (
      <div className="flex flex-col gap-4" data-testid="live-floor">
        {header}
        {notice}
        <KpiCards summary={summary.summary} error={summary.error} onRetry={() => void summary.reload()} model={model} timezone={restaurant.timezone} />
        <Button variant="outline" className="self-start" onClick={() => setShowPlan((v) => !v)} aria-expanded={showPlan}>
          <MapIcon aria-hidden data-icon="inline-start" />
          {showPlan ? "Ocultar plano" : "Ver plano"}
        </Button>
        {showPlan ? (
          <div className="relative overflow-hidden rounded-2xl border border-border bg-[#f4f2ef]">
            <LiveScene data={sceneData} label={sceneLabel} onSelect={select} describe={describe} camera={camera.turns} className="aspect-[4/3] w-full" />
            <CameraControls turns={camera.turns} onTurn={camera.turn} className="absolute top-2 right-2 z-[2] rounded-lg bg-background/70 p-0.5 backdrop-blur-sm" />
          </div>
        ) : null}
        <ZoneLists model={model} now={now} onSelect={select} riders={ridersCard("h-64 border-0 p-0 shadow-none")} />
        <TrackingStrip order={tracked} ctx={ctx} />
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
            <SheetHeader className="sr-only">
              <SheetTitle>Detalle</SheetTitle>
              <SheetDescription>Lo que seleccionaste en la vista en vivo.</SheetDescription>
            </SheetHeader>
            <DetailPanel target={target} ctx={ctx} />
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  // Desktop: the stage breaks out of the admin column (up to 1440 px), the cards float over the scene from 1280 px.
  return (
    <div className="flex flex-col gap-4 lg:mx-[calc(50%_-_min(720px,50vw_-_1.5rem))]" data-testid="live-floor">
      {header}
      {notice}
      <section
        className="relative grid grid-cols-2 gap-3 overflow-hidden rounded-3xl border border-border p-3 xl:block xl:h-[clamp(760px,calc(100dvh_-_9rem),900px)] xl:p-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 55% at 38% 52%, #fffdfb 0%, rgba(255,253,251,0) 70%), radial-gradient(circle at 1px 1px, rgba(120,113,108,.14) 1px, transparent 1.2px) 0 0/22px 22px, #f4f2ef",
        }}
        aria-label={`Plano en vivo de ${restaurant.name}`}
      >
        <KpiCards
          summary={summary.summary}
          error={summary.error}
          onRetry={() => void summary.reload()}
          model={model}
          timezone={restaurant.timezone}
          className="col-span-2 xl:absolute xl:top-4 xl:left-4 xl:z-[2] xl:w-[min(880px,calc(100%_-_400px))]"
        />
        <LiveScene
          data={sceneData}
          label={sceneLabel}
          onSelect={select}
          describe={describe}
          camera={camera.turns}
          className="col-span-2 aspect-[16/10] xl:absolute xl:top-[132px] xl:right-[368px] xl:bottom-[146px] xl:left-0 xl:aspect-auto"
        />
        {/* Front-left corner of the scene: the kitchen and the tickets usually sit at the back or on the right. */}
        {ridersCard("col-span-2 h-64 xl:absolute xl:left-4 xl:bottom-[162px] xl:z-[2] xl:h-[230px] xl:w-[240px]")}
        <TrackingStrip order={tracked} ctx={ctx} className="col-span-2 xl:absolute xl:right-[376px] xl:bottom-4 xl:left-4 xl:z-[2]" />
        <DetailPanel target={target} ctx={ctx} className={cn(GLASS, "max-h-[520px] overflow-auto xl:absolute xl:top-4 xl:right-4 xl:bottom-[330px] xl:z-[3] xl:max-h-none xl:w-[344px]")} />
        <WorkQueue model={model} now={now} onSelect={select} className="max-h-[520px] xl:absolute xl:right-4 xl:bottom-4 xl:z-[3] xl:h-[300px] xl:max-h-none xl:w-[344px]" />
      </section>
      {/* Kitchen groups as text for screen readers (the floating tickets are SVG). */}
      <p className="sr-only" aria-live="polite">
        {KITCHEN_GROUPS.map((g) => `${g.label}: ${model.groups.find((x) => x.key === g.key)?.tickets.length ?? 0}`).join(". ")}
      </p>
    </div>
  );
}
