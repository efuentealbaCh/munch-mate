"use client";

import { type CustomerOrderSummary, ORDER_CHANNEL_LABELS, ORDER_STATUS_LABELS } from "@app/types";
import { ChevronRightIcon, ReceiptTextIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { appendOrdersPage, historyTone, itemCountLabel } from "@/lib/customer";
import { customersApi } from "@/lib/endpoints";
import { formatDateTime } from "@/lib/format";
import { formatPrice } from "@/lib/money";
import { trackingHref } from "@/lib/order-tracking";
import { cn } from "@/lib/utils";

/**
 * "Mis pedidos": every order placed while signed in, across restaurants, newest first. Pages of 20 with
 * "Cargar más" (cursor `nextBefore`). Each one opens its tracking page.
 */
export function OrdersHistory() {
  const [orders, setOrders] = useState<CustomerOrderSummary[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadFirst = useCallback(async () => {
    setError(null);
    try {
      const page = await customersApi.orders();
      setOrders(page.items);
      setNextBefore(page.nextBefore);
    } catch (failure) {
      setError(failure);
    }
  }, []);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  async function loadMore() {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await customersApi.orders(nextBefore);
      setOrders((current) => appendOrdersPage(current ?? [], page));
      setNextBefore(page.nextBefore);
    } catch (failure) {
      setError(failure);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Mis pedidos</h1>
        <p className="text-sm text-muted-foreground">Los pedidos que hiciste con tu cuenta, en todos los locales.</p>
      </div>

      {orders === null ? (
        error ? (
          <div className="flex flex-col items-start gap-3">
            <FormError error={error} />
            <Button variant="outline" onClick={() => void loadFirst()}>
              Reintentar
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando pedidos">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          <ReceiptTextIcon className="size-8" aria-hidden />
          <p>Todavía no tienes pedidos con esta cuenta.</p>
          <p>Cuando pidas desde el menú de un local con tu sesión iniciada, aparecerán aquí.</p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3" data-testid="customer-orders">
            {orders.map((order) => (
              <li key={order.trackingToken}>
                <OrderRow order={order} />
              </li>
            ))}
          </ul>
          {error ? <FormError error={error} /> : null}
          {nextBefore ? (
            <Button
              variant="outline"
              className="self-center"
              disabled={loadingMore}
              aria-busy={loadingMore || undefined}
              onClick={() => void loadMore()}
            >
              {loadingMore ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              {loadingMore ? "Cargando…" : "Cargar más"}
            </Button>
          ) : (
            <p className="text-center text-xs text-muted-foreground">No hay más pedidos.</p>
          )}
        </>
      )}
    </div>
  );
}

function OrderRow({ order }: { order: CustomerOrderSummary }) {
  const tone = historyTone(order.status);
  return (
    <Link
      href={trackingHref(order.trackingToken)}
      className={cn(
        "group flex items-center gap-4 rounded-xl bg-card p-4 ring-1 transition-shadow outline-none hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50",
        tone === "active" ? "ring-primary/40" : "ring-foreground/10",
      )}
    >
      <span className="w-14 shrink-0 text-center text-2xl font-black tabular-nums">#{order.ticketNumber}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{order.restaurant.name}</span>
          <Badge variant={tone === "failed" ? "destructive" : tone === "active" ? "default" : "secondary"} data-testid="customer-order-status">
            {ORDER_STATUS_LABELS[order.status]}
          </Badge>
        </span>
        <span className="text-sm text-muted-foreground">
          {ORDER_CHANNEL_LABELS[order.channel]} · {itemCountLabel(order.itemCount)} · {formatDateTime(order.createdAt)}
        </span>
        <span className="text-xs text-muted-foreground">Pedido N° {order.number}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span className={cn("font-semibold tabular-nums", tone === "failed" && "text-muted-foreground line-through")}>
          {formatPrice(order.total, order.currency)}
        </span>
        <ChevronRightIcon className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
