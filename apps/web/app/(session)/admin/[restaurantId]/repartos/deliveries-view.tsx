"use client";

import { ORDER_STATUS_LABELS, type OrderStatus, type OrderView, PAYMENT_METHOD_LABELS, type PaymentMethod } from "@app/types";
import { nextStatuses } from "@app/utils";
import { AlarmClockIcon, BikeIcon, MapPinIcon, MessageSquareTextIcon, PhoneIcon, WalletIcon, WifiOffIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/hooks/use-now";
import { useSocketEvent } from "@/hooks/use-realtime";
import { useAuth } from "@/lib/auth-context";
import { addressLine, expectedPaymentLabel, mapsSearchUrl } from "@/lib/delivery";
import { deliveriesApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatClockTime, formatPhone, telHref } from "@/lib/format";
import { formatPrice } from "@/lib/money";
import { showsReadyEstimate } from "@/lib/order-tracking";
import {
  isFinalStatus,
  isPastReadyTime,
  isRider,
  mergeFetched,
  needsPaymentWarning,
  RIDER_ACTION_LABELS,
  RIDER_ACTOR,
  sortRiderDeliveries,
  upsertRiderDelivery,
} from "@/lib/orders-board";
import { cn } from "@/lib/utils";
import { HandOverDialog } from "../pedidos/order-dialogs";
import { useRestaurant } from "../restaurant-context";
import { useRestaurantRealtime } from "../restaurant-realtime";

/** "Repartos": the rider's own deliveries in progress, live. Only for members with the rider role. */
export function DeliveriesView() {
  const { restaurant } = useRestaurant();
  const { user } = useAuth();
  if (!isRider(restaurant.myRoles)) {
    return (
      <AccessDenied
        restaurantId={restaurant.id}
        title="Sin acceso"
        description="Esta pantalla es para repartidores: muestra los pedidos que te asignan."
      />
    );
  }
  if (!user) return null;
  return <RiderDeliveries riderId={user.id} />;
}

type Busy = OrderStatus | "payment";

function RiderDeliveries({ riderId }: { riderId: string }) {
  const { restaurant, reload: reloadRestaurant } = useRestaurant();
  const { socket, status: live, syncCount } = useRestaurantRealtime();
  const now = useNow(30_000);
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const [collecting, setCollecting] = useState<OrderView | null>(null);
  const [collectPending, setCollectPending] = useState<PaymentMethod | "handover" | null>(null);
  // Ids received by event while a request is in flight (see mergeFetched).
  const fetching = useRef<Set<string> | null>(null);
  // Latest list for the "new assignment" toast (kept out of the state updater, which may run twice).
  const ordersRef = useRef<OrderView[] | null>(null);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const refetch = useCallback(async () => {
    const received = new Set<string>();
    fetching.current = received;
    try {
      const fetched = await deliveriesApi.list(restaurant.id);
      setOrders((current) => mergeFetched(current ?? [], fetched, true, received));
      setError(null);
    } catch (failure) {
      setError(failure);
      if (hasCode(failure, "FORBIDDEN_ROLE")) reloadRestaurant();
    } finally {
      if (fetching.current === received) fetching.current = null;
    }
  }, [restaurant.id, reloadRestaurant]);

  // On mount and after every (re)subscription: events missed while disconnected are not replayed.
  useEffect(() => {
    void refetch();
  }, [refetch, syncCount]);

  // The restaurant room carries every order: keep only the deliveries assigned to me.
  const apply = useCallback(
    (order: OrderView) => {
      fetching.current?.add(order.id);
      const known = ordersRef.current;
      const assignedNow =
        known !== null &&
        !known.some((o) => o.id === order.id) &&
        order.channel === "delivery" &&
        order.rider?.id === riderId &&
        !isFinalStatus(order.status);
      if (assignedNow) toast(`Te asignaron el pedido #${order.ticketNumber}`);
      setOrders((current) => (current ? upsertRiderDelivery(current, order, riderId) : current));
    },
    [riderId],
  );
  useSocketEvent(socket, "order.updated", apply);
  useSocketEvent(socket, "order.created", apply);

  function setBusyFor(orderId: string, value: Busy | null) {
    setBusy((current) => {
      const next = { ...current };
      if (value) next[orderId] = value;
      else delete next[orderId];
      return next;
    });
  }

  function handleFailure(failure: unknown) {
    if (hasCode(failure, "ORDER_CHANGED", "INVALID_TRANSITION", "ORDER_NOT_FOUND", "NOT_YOUR_DELIVERY")) {
      // Someone else moved it, or it was reassigned: show the real list.
      toast.info(errorMessage(failure));
      void refetch();
      return;
    }
    toast.error(errorMessage(failure));
    if (hasCode(failure, "FORBIDDEN_ROLE")) reloadRestaurant();
  }

  async function changeStatus(order: OrderView, to: "out_for_delivery" | "delivered"): Promise<boolean> {
    setBusyFor(order.id, to);
    try {
      apply(await deliveriesApi.changeStatus(restaurant.id, order.id, to));
      return true;
    } catch (failure) {
      handleFailure(failure);
      return false;
    } finally {
      setBusyFor(order.id, null);
    }
  }

  function onAction(order: OrderView, to: OrderStatus) {
    if (to !== "out_for_delivery" && to !== "delivered") return;
    // Unpaid: ask how it was paid first (or "ya estaba pagado").
    if (needsPaymentWarning(order, to)) setCollecting(order);
    else
      void changeStatus(order, to).then((ok) => {
        if (ok) toast.success(to === "delivered" ? `Pedido #${order.ticketNumber} entregado` : `Saliste con el pedido #${order.ticketNumber}`);
      });
  }

  async function collectAndDeliver(order: OrderView, method: PaymentMethod) {
    setCollectPending(method);
    setBusyFor(order.id, "payment");
    let paid: OrderView;
    try {
      paid = await deliveriesApi.markPaid(restaurant.id, order.id, method);
      apply(paid);
    } catch (failure) {
      handleFailure(failure);
      setBusyFor(order.id, null);
      setCollectPending(null);
      return;
    }
    setBusyFor(order.id, null);
    const ok = await changeStatus(paid, "delivered");
    setCollectPending(null);
    setCollecting(null);
    if (ok) toast.success(`Cobrado (${PAYMENT_METHOD_LABELS[method]}) y entregado #${order.ticketNumber}`);
  }

  async function deliverWithoutPayment(order: OrderView) {
    setCollectPending("handover");
    const ok = await changeStatus(order, "delivered");
    setCollectPending(null);
    setCollecting(null);
    if (ok) toast.success(`Pedido #${order.ticketNumber} entregado`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold tracking-tight">Mis repartos</h2>
        <LiveBadge status={live} />
      </div>

      {!orders ? (
        error ? (
          <div className="flex flex-col items-start gap-3">
            <FormError error={error} />
            <Button variant="outline" onClick={() => void refetch()}>
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando repartos">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )
      ) : (
        <>
          {error ? <FormError error={error} /> : null}
          {orders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">
              <BikeIcon className="size-8" aria-hidden />
              <p>No tienes repartos asignados. Aparecen aquí apenas te asignen uno.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {sortRiderDeliveries(orders).map((order) => (
                <DeliveryCard
                  key={order.id}
                  order={order}
                  now={now}
                  busy={busy[order.id] ?? null}
                  onAction={(to) => onAction(order, to)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <HandOverDialog
        order={collecting}
        canPay
        pending={collectPending}
        handOverLabel="Ya estaba pagado · solo entregar"
        onOpenChange={(open) => !open && setCollecting(null)}
        onPayAndHandOver={(method) => collecting && void collectAndDeliver(collecting, method)}
        onHandOver={() => collecting && void deliverWithoutPayment(collecting)}
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

/** One delivery, big and thumb-friendly: who, where, what to collect (change highlighted) and the next step. */
function DeliveryCard({
  order,
  now,
  busy,
  onAction,
}: {
  order: OrderView;
  now: number;
  busy: Busy | null;
  onAction(to: OrderStatus): void;
}) {
  const actions = nextStatuses("delivery", order.status, RIDER_ACTOR);
  const delivery = order.delivery;
  const payment = order.expectedPayment;
  const change = payment?.change ?? null;
  const late = isPastReadyTime(order, now);
  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <article
      aria-labelledby={`delivery-${order.id}`}
      className={cn(
        "flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10",
        order.status === "out_for_delivery" && "ring-2 ring-primary",
      )}
      data-testid="delivery-card"
      data-ticket={order.ticketNumber}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 id={`delivery-${order.id}`} className="text-5xl leading-none font-black tracking-tight tabular-nums">
          <span className="sr-only">Pedido </span>#{order.ticketNumber}
        </h3>
        <div className="flex flex-col items-end gap-1 text-right">
          <Badge className="h-7 px-3 text-sm" data-testid="delivery-status">
            {ORDER_STATUS_LABELS[order.status]}
          </Badge>
          {showsReadyEstimate(order) && order.estimatedReadyAt ? (
            <span className={cn("flex items-center gap-1 text-sm font-semibold", late && "text-destructive")}>
              <AlarmClockIcon className="size-4" aria-hidden />
              Llega aprox. {formatClockTime(order.estimatedReadyAt)}
              {late ? <span className="font-normal">(atrasado)</span> : null}
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold">{order.customerName}</p>
        {order.customerPhone ? (
          <Button asChild variant="outline" size="lg" className="self-start">
            <a href={telHref(order.customerPhone)}>
              <PhoneIcon aria-hidden data-icon="inline-start" />
              <span className="sr-only">Llamar al </span>
              {formatPhone(order.customerPhone)}
            </a>
          </Button>
        ) : null}
      </div>

      {delivery ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3" data-testid="delivery-address">
          <p className="flex items-start gap-2">
            <MapPinIcon className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="text-lg font-semibold break-words">{addressLine(delivery)}</span>
              <span className="text-sm text-muted-foreground">{delivery.zoneName}</span>
              {delivery.reference ? <span className="text-sm break-words">Ref.: {delivery.reference}</span> : null}
            </span>
          </p>
          <Button asChild variant="secondary" className="self-start">
            <a href={mapsSearchUrl(delivery)} target="_blank" rel="noopener noreferrer">
              <MapPinIcon aria-hidden data-icon="inline-start" />
              Abrir en el mapa<span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
          </Button>
        </div>
      ) : null}

      {order.paymentStatus === "paid" ? (
        <p className="rounded-lg bg-success/10 px-3 py-2 font-semibold text-success" data-testid="delivery-payment">
          Pagado{order.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[order.paymentMethod]}` : ""}: no hay que cobrar
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-foreground/10" data-testid="delivery-payment">
          <p className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              <WalletIcon className="size-5 text-muted-foreground" aria-hidden />
              Cobrar
            </span>
            <span className="text-2xl font-black tabular-nums">{formatPrice(order.total, order.currency)}</span>
          </p>
          {payment ? <p className="text-sm text-muted-foreground">{expectedPaymentLabel(payment, order.currency)}</p> : null}
          {change !== null && change > 0 ? (
            <p className="rounded-lg bg-warning px-3 py-2 text-lg font-bold text-warning-foreground" data-testid="rider-change">
              Llevar vuelto: <span className="tabular-nums">{formatPrice(change, order.currency)}</span>
            </p>
          ) : null}
        </div>
      )}

      {order.note ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-warning px-2 py-1.5 text-sm text-warning-foreground">
          <MessageSquareTextIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {order.note}
        </p>
      ) : null}

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">
          {itemCount} {itemCount === 1 ? "producto" : "productos"}
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {order.items.map((item, index) => (
            <li key={`${item.productId}-${index}`}>
              <span className="tabular-nums">{item.quantity} ×</span> {item.name}
              {item.modifiers.length > 0 ? (
                <span className="text-muted-foreground"> · {item.modifiers.map((m) => m.optionName).join(", ")}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </details>

      {actions.length > 0 ? (
        <div className="flex flex-col gap-2">
          {actions.map((to) => (
            <Button
              key={to}
              size="lg"
              className="h-14 text-lg"
              disabled={busy !== null}
              aria-busy={busy === to || undefined}
              onClick={() => onAction(to)}
            >
              {busy === to ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              {RIDER_ACTION_LABELS[to] ?? ORDER_STATUS_LABELS[to]}
            </Button>
          ))}
        </div>
      ) : (
        <p className="rounded-lg bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
          Se está preparando en el local. Podrás salir cuando esté listo.
        </p>
      )}
    </article>
  );
}
