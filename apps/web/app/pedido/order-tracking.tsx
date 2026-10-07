"use client";

import { ORDER_STATUS_LABELS, type PublicOrderView } from "@app/types";
import { CheckIcon, CircleXIcon, CloudOffIcon, ReceiptTextIcon, SearchXIcon, UtensilsIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Brand } from "@/components/brand";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { subscribeWithTimeout, useOnVisible, useRealtime, useSocketEvent } from "@/hooks/use-realtime";
import { publicOrdersApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { formatPrice, formatPriceDelta } from "@/lib/money";
import {
  CUSTOMER_STATUS_HINTS,
  DINE_IN_STEPS,
  findMyOrder,
  loadMyOrders,
  type MyOrder,
  parseTrackingHash,
  stepIndex,
  trackingHref,
} from "@/lib/order-tracking";
import { cn } from "@/lib/utils";

function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

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
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col items-center gap-1 rounded-2xl bg-card px-4 py-6 text-center ring-1 ring-foreground/10" aria-labelledby="ticket">
        <p className="text-sm text-muted-foreground">
          {order.restaurant.name}
          {order.tableLabel ? ` · ${order.tableLabel}` : ""}
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
          <p className="text-sm text-muted-foreground">{CUSTOMER_STATUS_HINTS[order.status]}</p>
          {order.status === "rejected" && order.rejectReason ? (
            <p className="mt-1 rounded-lg bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive" data-testid="reject-reason">
              Motivo: {order.rejectReason}
            </p>
          ) : null}
        </div>
        <LiveIndicator status={live} />
      </section>

      {finished ? null : <StatusSteps order={order} />}

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
          <li className="flex items-baseline justify-between py-3">
            <span className="font-semibold">Total</span>
            <span className="text-lg font-bold tabular-nums">{formatPrice(order.total, order.currency)}</span>
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">Pagas en el local.</p>
      </section>

      <div className="flex flex-col gap-2">
        {tableToken ? (
          <Button asChild size="lg">
            <Link href={`/m/${tableToken}`}>
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
  const current = stepIndex(order.status);
  return (
    <ol className="flex items-start justify-between gap-1" aria-label="Avance del pedido">
      {DINE_IN_STEPS.map((status, index) => {
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
        <p>Todavía no haces pedidos desde este teléfono. Escanea el QR de tu mesa para pedir.</p>
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
