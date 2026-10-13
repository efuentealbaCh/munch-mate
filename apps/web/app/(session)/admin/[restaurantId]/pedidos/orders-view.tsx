"use client";

import { ORDER_STATUS_LABELS, type OrderStatus, type OrderView, type PaymentMethod } from "@app/types";
import { nextStatuses } from "@app/utils";
import { BellOffIcon, BellRingIcon, InboxIcon, WifiOffIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import { FormError } from "@/components/form-error";
import { PushDeviceButton } from "@/components/push-device-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChime } from "@/hooks/use-chime";
import { useMapConfig } from "@/hooks/use-map-config";
import { useNow } from "@/hooks/use-now";
import { useSocketEvent } from "@/hooks/use-realtime";
import { useReceiptDownload } from "@/hooks/use-receipt-download";
import { useAuth } from "@/lib/auth-context";
import { ordersApi, restaurantsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatPrice } from "@/lib/money";
import { liveOpenState, nextOpeningLabel } from "@/lib/opening-hours";
import {
  actionStep,
  availableChannelFilters,
  type BOARD_COLUMNS,
  boardColumns,
  boardTitle,
  canAssignRider,
  canRegisterPayment,
  type ChannelFilter,
  canWorkOrders,
  dayTotals,
  destinationLabel,
  filterByChannel,
  groupByColumn,
  handOverStatus,
  isDroppedStatus,
  mergeFetched,
  pendingCount,
  REASON_DIALOG_TEXTS,
  type ReasonStatus,
  sortNewestFirst,
  upsertOrder,
} from "@/lib/orders-board";
import { cn } from "@/lib/utils";
import { useRestaurant } from "../restaurant-context";
import { useRestaurantRealtime } from "../restaurant-realtime";
import { OrderCard, PaymentBadge } from "./order-card";
import { RiderMapDialog } from "./rider-map-dialog";
import { HandOverDialog, PaymentDialog, ReadyTimeDialog, ReasonDialog, RiderDialog } from "./order-dialogs";

/** How long a new order stays highlighted. */
const FRESH_MS = 10_000;

export function OrdersView() {
  const { restaurant } = useRestaurant();
  if (!canWorkOrders(restaurant.myRoles)) {
    return (
      <AccessDenied
        restaurantId={restaurant.id}
        title="Sin acceso"
        description="Solo dueños, caja y cocina pueden ver y atender los pedidos."
      />
    );
  }
  return <OrdersBoard />;
}

type Busy = OrderStatus | "payment" | "rider";

/** Subtitle of the "Recibiendo pedidos" switch: where customers can order from right now. */
function acceptingDescription(pickup: boolean, delivery: boolean): string {
  const extra = [pickup ? "para retirar" : null, delivery ? "con delivery" : null].filter(Boolean);
  if (extra.length === 0) return "Los clientes pueden pedir desde el QR de su mesa.";
  return `Los clientes pueden pedir desde el QR de su mesa y ${extra.join(" o ")}.`;
}

/**
 * A list kept in sync with REST + live events. `fetching` collects ids received by event while a request
 * is in flight, so a response built before them does not drop them (see mergeFetched).
 */
function useOrderList(restaurantId: string, scope: "active" | "today", enabled: boolean, syncCount: number) {
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fetching = useRef<Set<string> | null>(null);
  const activeOnly = scope === "active";

  const refetch = useCallback(async () => {
    const received = new Set<string>();
    fetching.current = received;
    try {
      const fetched = await ordersApi.list(restaurantId, scope);
      setOrders((current) => mergeFetched(current ?? [], fetched, activeOnly, received));
      setError(null);
    } catch (failure) {
      setError(failure);
    } finally {
      if (fetching.current === received) fetching.current = null;
    }
  }, [restaurantId, scope, activeOnly]);

  // On mount and after every (re)subscription: events missed while disconnected are not replayed.
  useEffect(() => {
    if (enabled) void refetch();
  }, [enabled, refetch, syncCount]);

  const apply = useCallback(
    (order: OrderView) => {
      fetching.current?.add(order.id);
      setOrders((current) => (current ? upsertOrder(current, order, activeOnly) : current));
    },
    [activeOnly],
  );

  return { orders, error, refetch, apply };
}

function OrdersBoard() {
  const { restaurant, setRestaurant, reload: reloadRestaurant } = useRestaurant();
  const { socket, status: live, syncCount } = useRestaurantRealtime();
  const roles = restaurant.myRoles;
  const canPay = canRegisterPayment(roles);
  const canAssign = canAssignRider(roles);
  const [tab, setTab] = useState<"board" | "today">("board");
  const active = useOrderList(restaurant.id, "active", true, syncCount);
  const today = useOrderList(restaurant.id, "today", tab === "today", syncCount);
  const now = useNow(30_000);
  const chime = useChime();
  const { user } = useAuth();
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  // Reject or cancel: both ask for a reason the customer will read.
  const [withReason, setWithReason] = useState<{ order: OrderView; status: ReasonStatus } | null>(null);
  const [paying, setPaying] = useState<OrderView | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null);
  const [acceptingWithTime, setAcceptingWithTime] = useState<OrderView | null>(null);
  // Phase 7: follow the rider of a delivery on its way (only with the base map).
  const map = useMapConfig();
  const [trackingRider, setTrackingRider] = useState<OrderView | null>(null);
  const [assigningRider, setAssigningRider] = useState<OrderView | null>(null);
  const [riderPending, setRiderPending] = useState<string | null>(null);
  const [handingOver, setHandingOver] = useState<OrderView | null>(null);
  const [handOverPending, setHandOverPending] = useState<PaymentMethod | "handover" | null>(null);
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [savingAccepting, setSavingAccepting] = useState(false);
  const switchId = useId();
  const receipts = useReceiptDownload(socket);

  const applyEverywhere = useCallback(
    (order: OrderView) => {
      active.apply(order);
      today.apply(order);
    },
    [active, today],
  );

  useSocketEvent(socket, "order.created", (order) => {
    applyEverywhere(order);
    chime.play();
    toast(`Nuevo pedido #${order.ticketNumber} · ${destinationLabel(order)}`);
    setFresh((current) => new Set(current).add(order.id));
    setTimeout(
      () =>
        setFresh((current) => {
          const next = new Set(current);
          next.delete(order.id);
          return next;
        }),
      FRESH_MS,
    );
  });
  useSocketEvent(socket, "order.updated", applyEverywhere);

  // "(2) Pedidos" in the browser tab while orders wait to be accepted.
  const pending = active.orders ? pendingCount(active.orders) : 0;
  useEffect(() => {
    const previous = document.title;
    document.title = `${boardTitle(pending)} · Munch Mate`;
    return () => {
      document.title = previous;
    };
  }, [pending]);

  function refetchAll() {
    void active.refetch();
    if (today.orders) void today.refetch();
  }

  function setBusyFor(orderId: string, value: Busy | null) {
    setBusy((current) => {
      const next = { ...current };
      if (value) next[orderId] = value;
      else delete next[orderId];
      return next;
    });
  }

  function handleFailure(failure: unknown) {
    if (hasCode(failure, "ORDER_CHANGED", "INVALID_TRANSITION", "ORDER_NOT_FOUND")) {
      // Someone else moved it first (another phone, the customer cancelled): show the real state.
      toast.info(errorMessage(failure));
      refetchAll();
      return;
    }
    toast.error(errorMessage(failure));
    // Lost the role meanwhile: the shell reloads and the screen explains it.
    if (hasCode(failure, "FORBIDDEN_ROLE")) reloadRestaurant();
  }

  async function changeStatus(
    order: OrderView,
    to: OrderStatus,
    extra?: { reason?: string; readyInMinutes?: number },
  ): Promise<boolean> {
    setBusyFor(order.id, to);
    try {
      applyEverywhere(await ordersApi.changeStatus(restaurant.id, order.id, to, extra));
      return true;
    } catch (failure) {
      handleFailure(failure);
      return false;
    } finally {
      setBusyFor(order.id, null);
    }
  }

  function onAction(order: OrderView, to: OrderStatus) {
    const step = actionStep(order, to, roles);
    if (step === "reason" && (to === "rejected" || to === "cancelled")) setWithReason({ order, status: to });
    // Pickup/delivery: the customer is told when to come (or when it arrives), so accepting asks for the minutes.
    else if (step === "ready_time") setAcceptingWithTime(order);
    else if (step === "payment_warning") setHandingOver(order);
    else void changeStatus(order, to);
  }

  /** Registers the payment, then hands the order over. Stops (and says so) if the payment fails. */
  async function payAndHandOver(order: OrderView, method: PaymentMethod) {
    setHandOverPending(method);
    setBusyFor(order.id, "payment");
    let paid: OrderView;
    try {
      paid = await ordersApi.markPaid(restaurant.id, order.id, method);
      applyEverywhere(paid);
    } catch (failure) {
      handleFailure(failure);
      setBusyFor(order.id, null);
      setHandOverPending(null);
      return;
    }
    setBusyFor(order.id, null);
    const ok = await changeStatus(paid, handOverStatus(order.channel) ?? "picked_up");
    setHandOverPending(null);
    setHandingOver(null);
    if (ok) toast.success(`Pago registrado y pedido #${order.ticketNumber} entregado`);
  }

  async function handOverUnpaid(order: OrderView) {
    setHandOverPending("handover");
    const ok = await changeStatus(order, handOverStatus(order.channel) ?? "picked_up");
    setHandOverPending(null);
    setHandingOver(null);
    if (ok) toast.success(`Pedido #${order.ticketNumber} entregado sin pago registrado`);
  }

  function downloadReceipt(order: OrderView) {
    void receipts.download(order.id, () => ordersApi.receipt(restaurant.id, order.id), order.id);
  }

  async function pay(order: OrderView, method: PaymentMethod) {
    setBusyFor(order.id, "payment");
    setPayMethod(method);
    try {
      applyEverywhere(await ordersApi.markPaid(restaurant.id, order.id, method));
      toast.success(`Pago registrado #${order.ticketNumber}`);
      setPaying(null);
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setBusyFor(order.id, null);
      setPayMethod(null);
    }
  }

  async function assignRider(order: OrderView, riderId: string | null) {
    setRiderPending(riderId ?? "none");
    setBusyFor(order.id, "rider");
    try {
      const updated = await ordersApi.assignRider(restaurant.id, order.id, riderId);
      applyEverywhere(updated);
      toast.success(
        updated.rider ? `Pedido #${order.ticketNumber} asignado a ${updated.rider.name}` : `Pedido #${order.ticketNumber} sin repartidor`,
      );
      setAssigningRider(null);
    } catch (failure) {
      // NOT_A_RIDER: the role was removed meanwhile; the dialog stays open and reloads its list on reopen.
      handleFailure(failure);
      if (hasCode(failure, "ORDER_NOT_FOUND")) setAssigningRider(null);
    } finally {
      setBusyFor(order.id, null);
      setRiderPending(null);
    }
  }

  async function setAccepting(acceptingOrders: boolean) {
    const previous = restaurant;
    setSavingAccepting(true);
    setRestaurant({ ...restaurant, acceptingOrders });
    try {
      setRestaurant(await restaurantsApi.setAcceptingOrders(restaurant.id, acceptingOrders));
      toast.success(acceptingOrders ? "Ahora recibes pedidos" : "Dejaste de recibir pedidos");
    } catch (failure) {
      setRestaurant(previous);
      toast.error(errorMessage(failure));
      if (hasCode(failure, "FORBIDDEN_ROLE")) reloadRestaurant();
    } finally {
      setSavingAccepting(false);
    }
  }

  const actionsFor = (order: OrderView) => nextStatuses(order.channel, order.status, { kind: "staff", roles });
  const reasonBusy = withReason ? busy[withReason.order.id] === withReason.status : false;
  const acceptingBusy = acceptingWithTime ? busy[acceptingWithTime.id] === "accepted" : false;
  const allOrders = [...(active.orders ?? []), ...(today.orders ?? [])];
  // The filter only makes sense once other channels exist (or can arrive); a filter that disappeared shows all.
  const channelFilters = availableChannelFilters(restaurant, allOrders);
  const effectiveChannel: ChannelFilter = channelFilters.some((filter) => filter.value === channel) ? channel : "all";
  const shownActive = active.orders && filterByChannel(active.orders, effectiveChannel);
  const shownToday = today.orders && filterByChannel(today.orders, effectiveChannel);
  const columns = boardColumns(restaurant.deliveryEnabled || allOrders.some((order) => order.channel === "delivery"));
  // The switch is on but the opening hours keep customers out (recomputed with the clock, not only at load).
  const schedule = liveOpenState(restaurant.openingHours, restaurant.timezone, now, restaurant.openState);
  const outsideHours = restaurant.acceptingOrders && !schedule.openNow;
  const openingLabel = outsideHours ? nextOpeningLabel(schedule.nextOpeningAt, new Date(now || Date.now())) : null;

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label="Estado del local"
        className={cn(
          "flex flex-col gap-3 rounded-xl p-4 ring-1 sm:flex-row sm:items-center sm:justify-between",
          restaurant.acceptingOrders && !outsideHours
            ? "bg-success/5 ring-success/30"
            : outsideHours
              ? "bg-warning ring-warning-foreground/30"
              : "bg-muted ring-foreground/10",
        )}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor={switchId} className="flex cursor-pointer items-center gap-4">
            <Switch
              id={switchId}
              size="lg"
              checked={restaurant.acceptingOrders}
              disabled={savingAccepting || restaurant.status === "suspended"}
              onCheckedChange={(checked) => void setAccepting(checked)}
            />
            <span className="flex flex-col">
              <span className="text-lg font-semibold">Recibiendo pedidos</span>
              <span className="text-sm text-muted-foreground">
                {restaurant.acceptingOrders
                  ? acceptingDescription(restaurant.pickupEnabled, restaurant.deliveryEnabled)
                  : "Cerrado: los clientes ven el menú pero no pueden pedir."}
              </span>
            </span>
          </label>
          {outsideHours ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" role="status" data-testid="outside-hours">
              <Badge variant="outline" className="border-warning-foreground/40 bg-warning text-warning-foreground">
                Fuera de horario
              </Badge>
              <span className="text-warning-foreground">
                Los clientes no pueden pedir.{openingLabel ? ` ${openingLabel}.` : ""}
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={chime.enabled ? "secondary" : "outline"} onClick={chime.toggle} aria-pressed={chime.enabled}>
            {chime.enabled ? <BellRingIcon aria-hidden data-icon="inline-start" /> : <BellOffIcon aria-hidden data-icon="inline-start" />}
            {chime.enabled ? "Sonido activado" : "Activar sonido"}
          </Button>
          {user ? <PushDeviceButton userId={user.id} label="Activar avisos en este dispositivo" /> : null}
          <LiveBadge status={live} />
        </div>
      </section>
      {chime.enabled && chime.blocked ? (
        <p className="-mt-3 text-sm text-muted-foreground" role="status">
          Toca la pantalla una vez para que el navegador permita el sonido.
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as "board" | "today")} className="gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="h-10 w-full sm:w-fit">
            <TabsTrigger value="board" className="px-4">
              En curso{pending > 0 ? <Badge className="ml-1">{pending}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value="today" className="px-4">
              Hoy
            </TabsTrigger>
          </TabsList>
          {channelFilters.length > 0 ? <ChannelFilterBar filters={channelFilters} value={effectiveChannel} onChange={setChannel} /> : null}
        </div>

        <TabsContent value="board">
          <BoardColumns
            columns={columns}
            orders={shownActive}
            filtered={effectiveChannel !== "all"}
            error={active.error}
            onRetry={() => void active.refetch()}
            render={(order) => (
              <OrderCard
                key={order.id}
                order={order}
                actions={actionsFor(order)}
                canPay={canPay}
                now={now}
                fresh={fresh.has(order.id)}
                busy={busy[order.id] ?? null}
                onAction={(to) => onAction(order, to)}
                onPay={() => setPaying(order)}
                receiptBusy={receipts.working.has(order.id)}
                onReceipt={() => downloadReceipt(order)}
                canAssignRider={canAssign}
                onAssignRider={() => setAssigningRider(order)}
                onTrackRider={map.available ? () => setTrackingRider(order) : undefined}
              />
            )}
          />
        </TabsContent>
        <TabsContent value="today">
          <TodayList
            columns={columns.length}
            orders={shownToday}
            error={today.error}
            canPay={canPay}
            busy={busy}
            onRetry={() => void today.refetch()}
            onPay={setPaying}
          />
        </TabsContent>
      </Tabs>

      <ReasonDialog
        order={withReason?.order ?? null}
        status={withReason?.status ?? "rejected"}
        pending={reasonBusy}
        onOpenChange={(open) => !open && setWithReason(null)}
        onConfirm={(reason) => {
          if (!withReason) return;
          const { order, status } = withReason;
          void changeStatus(order, status, { reason }).then((ok) => {
            setWithReason(null);
            if (ok) toast.success(`Pedido #${order.ticketNumber} ${REASON_DIALOG_TEXTS[status].done}`);
          });
        }}
      />
      <ReadyTimeDialog
        order={acceptingWithTime}
        pending={acceptingBusy}
        now={now}
        onOpenChange={(open) => !open && setAcceptingWithTime(null)}
        onAccept={(readyInMinutes) => {
          const order = acceptingWithTime;
          if (!order) return;
          void changeStatus(order, "accepted", { readyInMinutes }).then((ok) => {
            setAcceptingWithTime(null);
            const when = order.channel === "delivery" ? "llega en" : "listo en";
            if (ok) toast.success(`Pedido #${order.ticketNumber} aceptado · ${when} ${readyInMinutes} min`);
          });
        }}
      />
      {map.available && map.config ? (
        <RiderMapDialog
          restaurantId={restaurant.id}
          // The live copy, so the dialog title follows a reassignment.
          order={trackingRider ? (active.orders?.find((o) => o.id === trackingRider.id) ?? trackingRider) : null}
          config={map.config}
          onOpenChange={(open) => !open && setTrackingRider(null)}
        />
      ) : null}
      <RiderDialog
        restaurantId={restaurant.id}
        order={assigningRider}
        pending={riderPending}
        onOpenChange={(open) => !open && setAssigningRider(null)}
        onAssign={(riderId) => assigningRider && void assignRider(assigningRider, riderId)}
      />
      <HandOverDialog
        order={handingOver}
        canPay={canPay}
        pending={handOverPending}
        onOpenChange={(open) => !open && setHandingOver(null)}
        onPayAndHandOver={(method) => handingOver && void payAndHandOver(handingOver, method)}
        onHandOver={() => handingOver && void handOverUnpaid(handingOver)}
      />
      <PaymentDialog
        order={paying}
        pending={payMethod}
        onOpenChange={(open) => !open && setPaying(null)}
        onPay={(method) => paying && void pay(paying, method)}
      />
    </div>
  );
}

function LiveBadge({ status }: { status: string }) {
  if (status === "live") {
    return (
      <Badge variant="secondary" className="h-8 gap-1.5 px-3" data-testid="live-badge">
        <span className="size-2 rounded-full bg-success" aria-hidden />
        En vivo
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="h-8 gap-1.5 px-3 text-muted-foreground" role="status" data-testid="live-badge">
      <WifiOffIcon aria-hidden />
      {status === "denied" ? "Sin avisos en vivo · recarga" : "Reconectando…"}
    </Badge>
  );
}

/** Todos / Mesa / Retiro / Delivery (only the channels in use): applies to both tabs. */
function ChannelFilterBar({
  filters,
  value,
  onChange,
}: {
  filters: ReadonlyArray<{ value: ChannelFilter; label: string }>;
  value: ChannelFilter;
  onChange(value: ChannelFilter): void;
}) {
  return (
    <div role="group" aria-label="Filtrar por canal" className="flex gap-1 rounded-lg bg-muted p-1">
      {filters.map((filter) => (
        <Button
          key={filter.value}
          size="sm"
          variant={value === filter.value ? "secondary" : "ghost"}
          className={cn("h-8 flex-1 px-3 sm:flex-none", value === filter.value && "bg-background shadow-sm")}
          aria-pressed={value === filter.value}
          onClick={() => onChange(filter.value)}
        >
          {filter.label}
        </Button>
      ))}
    </div>
  );
}

/** Grid of the board: 4 columns, or 5 with "En reparto" (3 on mid screens so cards stay readable). */
function gridClass(columns: number): string {
  return columns > 4 ? "grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" : "grid gap-4 md:grid-cols-2 lg:grid-cols-4";
}

function ListState({ error, onRetry, columns }: { error: unknown; onRetry(): void; columns: number }) {
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormError error={error} />
        <Button variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      </div>
    );
  }
  return (
    <div className={gridClass(columns)} aria-busy="true" aria-label="Cargando pedidos">
      {Array.from({ length: columns }, (_, index) => (
        <Skeleton key={index} className="h-48 w-full" />
      ))}
    </div>
  );
}

function BoardColumns({
  columns: shownColumns,
  orders,
  filtered,
  error,
  onRetry,
  render,
}: {
  columns: ReadonlyArray<(typeof BOARD_COLUMNS)[number]>;
  orders: OrderView[] | null;
  /** A channel filter is on (changes the empty message). */
  filtered: boolean;
  error: unknown;
  onRetry(): void;
  render(order: OrderView): ReactNode;
}) {
  if (!orders) return <ListState error={error} onRetry={onRetry} columns={shownColumns.length} />;
  const columns = groupByColumn(orders);
  return (
    <div className="flex flex-col gap-3">
      {error ? <FormError error={error} /> : null}
      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          <InboxIcon className="size-8" aria-hidden />
          <p>
            {filtered
              ? "No hay pedidos en curso de este tipo."
              : "No hay pedidos en curso. Los nuevos aparecen aquí al instante."}
          </p>
        </div>
      ) : null}
      <div className={gridClass(shownColumns.length)}>
        {shownColumns.map((column) => {
          const list = columns[column.status];
          // On phones empty columns only waste scroll; on wider screens they keep the layout stable.
          return (
            <section
              key={column.status}
              aria-label={column.title}
              className={cn("flex flex-col gap-3", list.length === 0 && "hidden md:flex")}
              data-testid={`column-${column.status}`}
            >
              <h2 className="flex items-center justify-between text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                {column.title}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{list.length}</span>
              </h2>
              {list.map(render)}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TodayList({
  columns,
  orders,
  error,
  canPay,
  busy,
  onRetry,
  onPay,
}: {
  /** Board columns (only for the loading skeleton). */
  columns: number;
  orders: OrderView[] | null;
  error: unknown;
  canPay: boolean;
  busy: Record<string, Busy>;
  onRetry(): void;
  onPay(order: OrderView): void;
}) {
  if (!orders) return <ListState error={error} onRetry={onRetry} columns={columns} />;
  const sorted = sortNewestFirst(orders);
  const totals = dayTotals(orders);
  const currency = orders[0]?.currency ?? "CLP";
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-2 text-center" aria-label="Resumen del día">
        <Stat label="Pedidos" value={String(totals.count)} />
        <Stat label="Vendido" value={formatPrice(totals.total, currency)} />
        <Stat label="Pagado" value={formatPrice(totals.paid, currency)} />
      </dl>
      {totals.dropped > 0 ? (
        <p className="text-xs text-muted-foreground">
          No incluye {totals.dropped} {totals.dropped === 1 ? "pedido rechazado o cancelado" : "pedidos rechazados o cancelados"}.
        </p>
      ) : null}
      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Todavía no hay pedidos hoy.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl bg-card ring-1 ring-foreground/10" aria-label="Pedidos de hoy">
          {sorted.map((order) => (
            <li key={order.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3" data-testid="today-row">
              <span className="w-14 text-xl font-black tabular-nums">#{order.ticketNumber}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">
                  {destinationLabel(order)}
                  {order.customerName ? ` · ${order.customerName}` : ""}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(order.createdAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
              <Badge variant={isDroppedStatus(order.status) ? "destructive" : "secondary"}>
                {ORDER_STATUS_LABELS[order.status]}
              </Badge>
              <span className="w-20 text-right font-semibold tabular-nums">{formatPrice(order.total, order.currency)}</span>
              <span className="flex w-full items-center justify-end gap-2 sm:w-auto">
                <PaymentBadge order={order} />
                {canPay && order.paymentStatus === "unpaid" && !isDroppedStatus(order.status) ? (
                  <Button size="sm" variant="outline" disabled={busy[order.id] !== undefined} onClick={() => onPay(order)}>
                    Registrar pago
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-card px-2 py-3 ring-1 ring-foreground/10">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}

