"use client";

import { type OrderStatus, type OrderView, PAYMENT_METHOD_LABELS } from "@app/types";
import { ClockIcon, MessageSquareTextIcon, UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatPrice, formatPriceDelta } from "@/lib/money";
import { ACTION_LABELS, elapsedLabel, minutesSince } from "@/lib/orders-board";
import { cn } from "@/lib/utils";

/** Paid with its method, or "Sin pagar". */
export function PaymentBadge({ order }: { order: OrderView }) {
  return order.paymentStatus === "paid" ? (
    <Badge variant="secondary" className="bg-success/10 text-success">
      Pagado{order.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[order.paymentMethod]}` : ""}
    </Badge>
  ) : (
    <Badge variant="outline">Sin pagar</Badge>
  );
}

interface OrderCardProps {
  order: OrderView;
  /** Status changes this member may make, primary first (from nextStatuses). */
  actions: OrderStatus[];
  canPay: boolean;
  now: number;
  /** Just arrived: highlighted for a few seconds. */
  fresh: boolean;
  /** A request for this order is in flight (its buttons are disabled). */
  busy: OrderStatus | "payment" | null;
  onAction(to: OrderStatus): void;
  onPay(): void;
}

/** One order on the kitchen board: big ticket number, table, age, items and the next steps. */
export function OrderCard({ order, actions, canPay, now, fresh, busy, onAction, onPay }: OrderCardProps) {
  const minutes = now ? minutesSince(order.createdAt, now) : 0;
  const forward = actions.filter((status) => status !== "rejected" && status !== "cancelled");
  const backward = actions.filter((status) => status === "rejected" || status === "cancelled");
  const disabled = busy !== null;

  return (
    <article
      aria-labelledby={`order-${order.id}`}
      className={cn(
        "flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow",
        fresh && "animate-in ring-2 ring-primary fade-in-0 slide-in-from-top-2 duration-500",
      )}
      data-testid="order-card"
      data-ticket={order.ticketNumber}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h3 id={`order-${order.id}`} className="text-4xl leading-none font-black tracking-tight tabular-nums">
            <span className="sr-only">Pedido </span>#{order.ticketNumber}
          </h3>
          {order.tableLabel ? <span className="mt-1 text-lg font-semibold">{order.tableLabel}</span> : null}
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          {fresh ? <Badge>Nuevo</Badge> : null}
          <span className={cn("flex items-center gap-1 text-sm", minutes >= 15 ? "font-semibold text-destructive" : "text-muted-foreground")}>
            <ClockIcon className="size-3.5" aria-hidden />
            {now ? elapsedLabel(minutes) : null}
          </span>
        </div>
      </header>

      {order.customerName ? (
        <p className="flex items-center gap-1.5 text-sm">
          <UserIcon className="size-4 text-muted-foreground" aria-hidden />
          {order.customerName}
        </p>
      ) : null}

      <ul className="flex flex-col gap-1.5 border-t pt-2" aria-label="Productos">
        {order.items.map((item, index) => (
          <li key={`${item.productId}-${index}`} className="flex flex-col">
            <span className="font-semibold">
              <span className="tabular-nums">{item.quantity} ×</span> {item.name}
            </span>
            {item.modifiers.length > 0 ? (
              <span className="text-sm text-muted-foreground">
                {item.modifiers.map((m) => `${m.optionName}${m.priceDelta ? ` (${formatPriceDelta(m.priceDelta, order.currency)})` : ""}`).join(" · ")}
              </span>
            ) : null}
            {item.note ? <span className="text-sm font-medium text-warning-foreground">Nota: {item.note}</span> : null}
          </li>
        ))}
      </ul>

      {order.note ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-warning px-2 py-1.5 text-sm text-warning-foreground">
          <MessageSquareTextIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {order.note}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
        <span className="font-bold tabular-nums">{formatPrice(order.total, order.currency)}</span>
        <PaymentBadge order={order} />
      </div>

      {forward.length > 0 || backward.length > 0 || (canPay && order.paymentStatus === "unpaid") ? (
        <div className="flex flex-col gap-2">
          {forward.map((status, index) => (
            <Button
              key={status}
              size="lg"
              variant={index === 0 ? "default" : "outline"}
              disabled={disabled}
              aria-busy={busy === status || undefined}
              onClick={() => onAction(status)}
            >
              {busy === status ? <Spinner aria-hidden data-icon="inline-start" /> : null}
              {ACTION_LABELS[status] ?? status}
            </Button>
          ))}
          <div className="flex flex-wrap gap-2">
            {canPay && order.paymentStatus === "unpaid" ? (
              <Button variant="outline" className="flex-1" disabled={disabled} onClick={onPay}>
                Registrar pago
              </Button>
            ) : null}
            {backward.map((status) => (
              <Button
                key={status}
                variant={status === "rejected" ? "destructive" : "ghost"}
                className="flex-1"
                disabled={disabled}
                aria-busy={busy === status || undefined}
                onClick={() => onAction(status)}
              >
                {busy === status ? <Spinner aria-hidden data-icon="inline-start" /> : null}
                {status === "cancelled" ? "Cancelar pedido" : (ACTION_LABELS[status] ?? status)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
