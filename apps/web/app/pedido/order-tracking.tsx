"use client";

import { ORDER_CHANNEL_LABELS, ORDER_STATUS_LABELS, type PublicOrderView } from "@app/types";
import { formatPhone } from "@app/utils";
import {
  BikeIcon,
  CheckIcon,
  CircleXIcon,
  ClockIcon,
  CloudOffIcon,
  DownloadIcon,
  MapPinIcon,
  PartyPopperIcon,
  PhoneIcon,
  ReceiptTextIcon,
  SearchXIcon,
  UtensilsIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Brand } from "@/components/brand";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useReceiptDownload } from "@/hooks/use-receipt-download";
import { subscribeWithTimeout, useOnVisible, useRealtime, useSocketEvent } from "@/hooks/use-realtime";
import { localStore } from "@/lib/browser-storage";
import { addressLine, customerPaymentLabel } from "@/lib/delivery";
import { publicOrdersApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatClockTime, formatDateTime, telHref } from "@/lib/format";
import { formatPrice, formatPriceDelta } from "@/lib/money";
import {
  customerStatusHint,
  customerSteps,
  estimateLabel,
  findMyOrder,
  loadMyOrders,
  type MyOrder,
  parseTrackingHash,
  showsReadyEstimate,
  stepIndex,
  trackingHref,
} from "@/lib/order-tracking";
import { cn } from "@/lib/utils";
import { RiderTracking } from "./rider-tracking";

/** Keeps the newest copy: a REST answer and a socket event can arrive in any order. */
function newest(current: PublicOrderView | null, incoming: PublicOrderView): PublicOrderView {
  return current && current.updatedAt > incoming.updatedAt ? current : incoming;
}

/** Reads the token from the fragment and follows its changes ("Mis pedidos" links only change the hash). */
function useHashToken(): { token: string | null; ready: boolean } {
  const [state, setState] = useState<{ token: string | null; ready: boolean }>({ token: null, ready: false });
  useEffect(() => {
    const read = () => setState({ token: parseTrackingHash(window.location.hash), ready: true });
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return state;
}

export function OrderTracking() {
  const { token, ready } = useHashToken();
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  useEffect(() => setMyOrders(loadMyOrders(localStore())), [token]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-6">
        {!ready ? (
          <TrackingSkeleton />
        ) : token ? (
          <TrackedOrder key={token} token={token} />
        ) : (
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">Mis pedidos</h1>
            <p className="text-sm text-muted-foreground">Los pedidos que hiciste desde este teléfono.</p>
          </div>
        )}
        {ready ? <MyOrdersList orders={myOrders} current={token} /> : null}
      </main>
      <footer className="flex justify-center px-4 py-6">
        <Brand className="text-sm" />
      </footer>
    </div>
  );
}

function TrackingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando pedido">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function TrackedOrder({ token }: { token: string }) {
  const [order, setOrder] = useState<PublicOrderView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [tableToken, setTableToken] = useState<string | undefined>(undefined);

  useEffect(() => setTableToken(findMyOrder(localStore(), token)?.tableToken), [token]);

  const refetch = useCallback(async () => {
    try {
      const fresh = await publicOrdersApi.lookup(token);
      setOrder((current) => newest(current, fresh));
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [token]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const { socket, status: live } = useRealtime(`order:${token}`, {
    enabled: !hasCode(error, "ORDER_NOT_FOUND"),
    subscribe: (s) => subscribeWithTimeout(s, "order.subscribe", token),
    // Events missed while disconnected are not replayed: read the order again after every (re)connect.
    onSubscribed: () => void refetch(),
  });
  useSocketEvent(socket, "order.status", (incoming) => setOrder((current) => newest(current, incoming)));
  // The customer's socket only joins this order's room: any receipt event is about this order.
  const receipt = useReceiptDownload(socket);
  const downloading = receipt.working.size > 0;
  // Phones suspend background tabs (and their sockets): catch up when the customer comes back.
  useOnVisible(() => void refetch());

  useEffect(() => {
    if (order) document.title = `#${order.ticketNumber} · ${ORDER_STATUS_LABELS[order.status]} · Munch Mate`;
  }, [order]);

  async function cancel() {
    setCancelling(true);
    try {
      setOrder(await publicOrdersApi.cancel(token));
      toast.success("Cancelaste tu pedido");
    } catch (failure) {
      toast.error(errorMessage(failure));
      if (hasCode(failure, "ORDER_NOT_CANCELLABLE")) void refetch();
    } finally {
      setCancelling(false);
      setConfirmCancel(false);
    }
  }

  if (hasCode(error, "ORDER_NOT_FOUND")) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-10 text-center" role="alert">
        <SearchXIcon className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">No encontramos este pedido</h1>
        <p className="text-sm text-muted-foreground">Revisa que el enlace esté completo o pide ayuda al personal.</p>
      </div>
    );
  }
  if (!order) {
    if (error) {
      return (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="alert">
          <CloudOffIcon className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-medium">{errorMessage(error)}</p>
          <Button onClick={() => void refetch()}>Reintentar</Button>
        </div>
      );
    }
    return <TrackingSkeleton />;
  }

  const finished = order.status === "rejected" || order.status === "cancelled";
  // Pickup and delivery are ordered from the public menu (no table): contact phone, "pedir algo más" there.
  const remote = order.channel !== "dine_in";
  const readyForPickup = order.channel === "pickup" && order.status === "ready";
  const onTheWay = order.channel === "delivery" && order.status === "out_for_delivery";
  const handedOver = order.status === "picked_up" || order.status === "delivered";
  const highlighted = readyForPickup || onTheWay || order.status === "delivered";
  const destination = order.channel === "dine_in" ? order.tableLabel : ORDER_CHANNEL_LABELS[order.channel];
  const orderMoreHref = tableToken ? `/m/${tableToken}` : remote ? `/r/${order.restaurant.slug}` : null;
  return (
    <div className="flex flex-col gap-5">
      <section
        className={cn(
          "flex flex-col items-center gap-1 rounded-2xl px-4 py-6 text-center",
          highlighted ? "bg-success/10 ring-2 ring-success" : "bg-card ring-1 ring-foreground/10",
        )}
        aria-labelledby="ticket"
      >
        <p className="text-sm text-muted-foreground" data-testid="order-destination">
          {order.restaurant.name}
          {destination ? ` · ${destination}` : ""}
        </p>
        <h1 id="ticket" className="text-6xl font-black tracking-tight tabular-nums" aria-label={`Pedido número ${order.ticketNumber}`}>
          #{order.ticketNumber}
        </h1>
        <p className="text-xs text-muted-foreground">
          Pedido N° {order.number} · {formatDateTime(order.createdAt)}
        </p>
        <div aria-live="polite" className="mt-3 flex flex-col items-center gap-1">
          <Badge
            variant={finished ? "destructive" : "default"}
            className="h-7 px-3 text-base"
            data-testid="order-status"
          >
            {ORDER_STATUS_LABELS[order.status]}
          </Badge>
          {readyForPickup ? (
            <>
              <p className="mt-1 flex items-center gap-2 text-lg font-bold text-success" data-testid="ready-for-pickup">
                <PartyPopperIcon className="size-5" aria-hidden />
                Ya puedes retirarlo
              </p>
              <p className="text-sm text-muted-foreground">Di tu número #{order.ticketNumber} al retirar.</p>
            </>
          ) : onTheWay ? (
            <p className="mt-1 flex items-center gap-2 text-lg font-bold text-success" data-testid="on-the-way">
              <BikeIcon className="size-5" aria-hidden />
              {order.riderName ? `${order.riderName} va en camino` : "Tu pedido va en camino"}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{customerStatusHint(order.status, order.channel)}</p>
          )}
          {showsReadyEstimate(order) && order.estimatedReadyAt ? (
            <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-base font-semibold" data-testid="ready-at">
              <ClockIcon className="size-4" aria-hidden />
              {estimateLabel(order.channel)} a las {formatClockTime(order.estimatedReadyAt)}
            </p>
          ) : null}
          {order.status === "rejected" && order.rejectReason ? (
            <p className="mt-1 rounded-lg bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive" data-testid="reject-reason">
              Motivo: {order.rejectReason}
            </p>
          ) : null}
          {order.status === "cancelled" && order.cancelReason ? (
            <p className="mt-1 rounded-lg bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive" data-testid="cancel-reason">
              Motivo: {order.cancelReason}
            </p>
          ) : null}
        </div>
        <LiveIndicator status={live} />
      </section>

      {onTheWay && order.delivery ? (
        <RiderTracking token={token} socket={socket} live={live} delivery={order.delivery} riderName={order.riderName} />
      ) : null}

      {finished ? null : <StatusSteps order={order} />}

      {order.delivery && !finished ? <DeliveryDetails order={order} /> : null}

      {remote && order.restaurant.phone && !finished && !handedOver ? (
        <a
          href={telHref(order.restaurant.phone)}
          className="flex min-h-11 items-center justify-center gap-2 self-center rounded-md px-3 text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          data-testid="restaurant-phone"
        >
          <PhoneIcon className="size-4" aria-hidden />
          ¿Algún problema? Llama al local: {formatPhone(order.restaurant.phone)}
        </a>
      ) : null}

      <section aria-labelledby="detalle" className="flex flex-col gap-2">
        <h2 id="detalle" className="font-semibold">
          Detalle
        </h2>
        <ul className="flex flex-col divide-y rounded-xl bg-card px-4 ring-1 ring-foreground/10">
          {order.items.map((item, index) => (
            <li key={`${item.productId}-${index}`} className="flex items-start justify-between gap-3 py-3 text-sm">
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {item.quantity} × {item.name}
                </span>
                {item.modifiers.map((modifier) => (
                  <span key={`${modifier.groupName}-${modifier.optionName}`} className="text-muted-foreground">
                    {modifier.optionName} {formatPriceDelta(modifier.priceDelta, order.currency)}
                  </span>
                ))}
                {item.note ? <span className="text-muted-foreground italic">«{item.note}»</span> : null}
              </div>
              <span className="tabular-nums">{formatPrice(item.lineTotal, order.currency)}</span>
            </li>
          ))}
          {order.channel === "delivery" ? (
            <li className="flex flex-col gap-1 py-3 text-sm">
              <span className="flex justify-between gap-3">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatPrice(order.subtotal, order.currency)}</span>
              </span>
              <span className="flex justify-between gap-3">
                <span className="text-muted-foreground">Envío{order.delivery ? ` a ${order.delivery.zoneName}` : ""}</span>
                <span className="tabular-nums" data-testid="delivery-fee">
                  {order.deliveryFee > 0 ? formatPrice(order.deliveryFee, order.currency) : "Gratis"}
                </span>
              </span>
            </li>
          ) : null}
          <li className="flex items-baseline justify-between py-3">
            <span className="font-semibold">Total</span>
            <span className="text-lg font-bold tabular-nums" data-testid="order-total">
              {formatPrice(order.total, order.currency)}
            </span>
          </li>
        </ul>
        {order.channel === "delivery" ? null : (
          <p className="text-xs text-muted-foreground">{remote ? "Pagas al retirar." : "Pagas en el local."}</p>
        )}
      </section>

      <div className="flex flex-col gap-2">
        {order.receiptAvailable ? (
          <Button
            variant="outline"
            size="lg"
            disabled={downloading}
            aria-busy={downloading || undefined}
            onClick={() => void receipt.download("receipt", () => publicOrdersApi.receipt(token))}
          >
            {downloading ? <Spinner aria-hidden data-icon="inline-start" /> : <DownloadIcon aria-hidden data-icon="inline-start" />}
            {downloading ? "Preparando comprobante…" : "Descargar comprobante"}
          </Button>
        ) : null}
        {orderMoreHref ? (
          <Button asChild size="lg" variant={remote ? "secondary" : "default"}>
            <Link href={orderMoreHref}>
              <UtensilsIcon aria-hidden data-icon="inline-start" />
              Pedir algo más
            </Link>
          </Button>
        ) : null}
        {order.cancellable ? (
          <Button variant="destructive" size="lg" onClick={() => setConfirmCancel(true)}>
            <CircleXIcon aria-hidden data-icon="inline-start" />
            Cancelar pedido
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="¿Cancelar tu pedido?"
        description="El local todavía no lo acepta. Si lo cancelas, tendrás que pedir de nuevo."
        confirmLabel="Cancelar pedido"
        destructive
        pending={cancelling}
        onConfirm={() => void cancel()}
      />
    </div>
  );
}

/** Where it goes and how the customer said they would pay (delivery only). */
function DeliveryDetails({ order }: { order: PublicOrderView }) {
  const delivery = order.delivery;
  if (!delivery) return null;
  return (
    <section aria-labelledby="entrega" className="flex flex-col gap-2 rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
      <h2 id="entrega" className="font-semibold">
        Entrega
      </h2>
      <p className="flex items-start gap-2" data-testid="delivery-address">
        <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex flex-col">
          <span className="font-medium break-words">{addressLine(delivery)}</span>
          <span className="text-muted-foreground">{delivery.zoneName}</span>
          {delivery.reference ? <span className="text-muted-foreground break-words">Ref.: {delivery.reference}</span> : null}
        </span>
      </p>
      {order.expectedPayment && order.status !== "delivered" ? (
        <p className="flex items-start gap-2" data-testid="expected-payment">
          <WalletIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            Pagas al recibir: <span className="font-medium">{customerPaymentLabel(order.expectedPayment, order.currency)}</span>
          </span>
        </p>
      ) : null}
    </section>
  );
}

function LiveIndicator({ status }: { status: string }) {
  const live = status === "live";
  return (
    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="live-indicator">
      <span className={cn("size-2 rounded-full", live ? "bg-success" : "bg-muted-foreground/50")} aria-hidden />
      {live ? "Se actualiza solo" : "Reconectando… recarga si no cambia"}
    </p>
  );
}

function StatusSteps({ order }: { order: PublicOrderView }) {
  const current = stepIndex(order.status, order.channel);
  return (
    <ol className="flex items-start justify-between gap-1" aria-label="Avance del pedido">
      {customerSteps(order.channel).map((status, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={status} className="flex flex-1 flex-col items-center gap-1 text-center" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "border-border text-muted-foreground",
              )}
              aria-hidden
            >
              {done ? <CheckIcon className="size-4" /> : index + 1}
            </span>
            <span className={cn("text-[0.7rem] leading-tight", active ? "font-semibold" : "text-muted-foreground")}>
              {ORDER_STATUS_LABELS[status]}
              {done ? <span className="sr-only"> (listo)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function MyOrdersList({ orders, current }: { orders: MyOrder[]; current: string | null }) {
  const others = orders.filter((order) => order.accessToken !== current);
  if (others.length === 0) {
    return current ? null : (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        <ReceiptTextIcon className="size-8" aria-hidden />
        <p>Todavía no haces pedidos desde este teléfono. Escanea el QR de tu mesa o pide desde el menú del local.</p>
      </div>
    );
  }
  return (
    <section aria-labelledby="mis-pedidos" className="flex flex-col gap-2">
      {current ? (
        <h2 id="mis-pedidos" className="font-semibold">
          Mis otros pedidos
        </h2>
      ) : (
        <h2 id="mis-pedidos" className="sr-only">
          Lista de pedidos
        </h2>
      )}
      <ul className="flex flex-col divide-y rounded-xl bg-card ring-1 ring-foreground/10">
        {others.map((order) => (
          <li key={order.accessToken}>
            {/* Plain <a>: only the fragment changes, and the page follows hashchange. */}
            <a
              href={trackingHref(order.accessToken)}
              className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex flex-col">
                <span className="font-semibold">#{order.ticketNumber}</span>
                <span className="text-sm text-muted-foreground">{order.restaurantName}</span>
              </span>
              <span className="text-sm text-muted-foreground">{formatDateTime(order.createdAt)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
