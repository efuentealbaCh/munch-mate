"use client";

import { type OrderStatus, type OrderView, PAYMENT_METHOD_LABELS } from "@app/types";
import { formatPhone } from "@app/utils";
import {
  AlarmClockIcon,
  BikeIcon,
  ClockIcon,
  DownloadIcon,
  MailIcon,
  MapPinIcon,
  MessageSquareTextIcon,
  PhoneIcon,
  ShoppingBagIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatClockTime, telHref } from "@/lib/format";
import { formatPrice, formatPriceDelta } from "@/lib/money";
import { addressLine, expectedPaymentLabel, mapsSearchUrl } from "@/lib/delivery";
import { estimateLabel, showsReadyEstimate } from "@/lib/order-tracking";
import { ACTION_LABELS, destinationLabel, elapsedLabel, isFinalStatus, isPastReadyTime, minutesSince } from "@/lib/orders-board";
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
  busy: OrderStatus | "payment" | "rider" | null;
  onAction(to: OrderStatus): void;
  onPay(): void;
  /** The receipt PDF is being downloaded. */
  receiptBusy: boolean;
  onReceipt(): void;
  /** Owner/cashier: may assign a rider to delivery orders. */
  canAssignRider: boolean;
  onAssignRider(): void;
}

/**
 * One order on the kitchen board: big ticket number, where it goes (table, pickup or delivery zone), age,
 * customer, delivery address and expected payment, items and the next steps.
 */
export function OrderCard({
  order,
  actions,
  canPay,
  now,
  fresh,
  busy,
  onAction,
  onPay,
  receiptBusy,
  onReceipt,
  canAssignRider,
  onAssignRider,
}: OrderCardProps) {
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
      data-channel={order.channel}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h3 id={`order-${order.id}`} className="text-4xl leading-none font-black tracking-tight tabular-nums">
            <span className="sr-only">Pedido </span>#{order.ticketNumber}
          </h3>
          {order.channel === "dine_in" ? (
            order.tableLabel ? (
              <span className="mt-1 text-lg font-semibold" data-testid="order-destination">
                {order.tableLabel}
              </span>
            ) : null
          ) : (
            <span className="mt-1.5 flex items-center gap-1.5 self-start rounded-md bg-brand-soft px-2 py-0.5 text-base font-semibold" data-testid="order-destination">
              {order.channel === "delivery" ? <BikeIcon className="size-4" aria-hidden /> : <ShoppingBagIcon className="size-4" aria-hidden />}
              {destinationLabel(order)}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          {fresh ? <Badge>Nuevo</Badge> : null}
          <span className={cn("flex items-center gap-1 text-sm", minutes >= 15 ? "font-semibold text-destructive" : "text-muted-foreground")}>
            <ClockIcon className="size-3.5" aria-hidden />
            {now ? elapsedLabel(minutes) : null}
          </span>
        </div>
      </header>

      {showsReadyEstimate(order) && order.estimatedReadyAt ? (
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            isPastReadyTime(order, now) ? "text-destructive" : "text-foreground",
          )}
          data-testid="ready-at"
        >
          <AlarmClockIcon className="size-4" aria-hidden />
          {estimateLabel(order.channel)} {formatClockTime(order.estimatedReadyAt)}
          {isPastReadyTime(order, now) ? <span className="font-normal">(atrasado)</span> : null}
        </p>
      ) : null}

      {order.customerName || order.customerPhone || order.customerEmail ? (
        <div className="flex flex-col gap-1 text-sm" data-testid="order-customer">
          {order.customerName ? (
            <p className="flex items-center gap-1.5">
              <UserIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {order.customerName}
            </p>
          ) : null}
          {order.customerPhone ? (
            <a
              href={telHref(order.customerPhone)}
              className="flex min-h-8 items-center gap-1.5 self-start rounded-md font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <PhoneIcon className="size-4 shrink-0" aria-hidden />
              <span className="sr-only">Llamar al </span>
              {formatPhone(order.customerPhone)}
            </a>
          ) : null}
          {order.customerEmail ? (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <MailIcon className="size-4 shrink-0" aria-hidden />
              <span className="break-all">{order.customerEmail}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {order.delivery ? (
        <DeliveryBlock order={order} canAssignRider={canAssignRider} disabled={disabled} onAssignRider={onAssignRider} />
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
        <span className="flex flex-col">
          <span className="font-bold tabular-nums">{formatPrice(order.total, order.currency)}</span>
          {order.deliveryFee > 0 ? (
            <span className="text-xs text-muted-foreground">incluye envío {formatPrice(order.deliveryFee, order.currency)}</span>
          ) : null}
        </span>
        <PaymentBadge order={order} />
      </div>

      {forward.length > 0 || backward.length > 0 || (canPay && order.paymentStatus === "unpaid") || order.receiptAvailable ? (
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
            {order.receiptAvailable ? (
              <Button
                variant="outline"
                className="flex-1"
                disabled={receiptBusy}
                aria-busy={receiptBusy || undefined}
                onClick={onReceipt}
              >
                {receiptBusy ? <Spinner aria-hidden data-icon="inline-start" /> : <DownloadIcon aria-hidden data-icon="inline-start" />}
                Comprobante
              </Button>
            ) : null}
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

/** Address (with a map search), expected payment with the change to bring, and the rider. */
function DeliveryBlock({
  order,
  canAssignRider,
  disabled,
  onAssignRider,
}: {
  order: OrderView;
  canAssignRider: boolean;
  disabled: boolean;
  onAssignRider(): void;
}) {
  const delivery = order.delivery;
  if (!delivery) return null;
  const change = order.expectedPayment?.change ?? null;
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-2.5 text-sm">
      <div className="flex items-start gap-1.5" data-testid="order-address">
        <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold break-words">{addressLine(delivery)}</span>
          {delivery.reference ? <span className="break-words text-muted-foreground">Ref.: {delivery.reference}</span> : null}
          <a
            href={mapsSearchUrl(delivery)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex min-h-8 items-center self-start rounded-md font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Ver en el mapa<span className="sr-only"> (se abre en una pestaña nueva)</span>
          </a>
        </span>
      </div>
      {order.expectedPayment && order.paymentStatus === "unpaid" ? (
        <p className="flex items-start gap-1.5" data-testid="expected-payment">
          <WalletIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            Paga al recibir: <span className="font-medium">{expectedPaymentLabel(order.expectedPayment, order.currency)}</span>
            {change !== null && change > 0 ? (
              <span className="mt-1 block font-bold text-foreground">
                Llevar vuelto: <span className="tabular-nums">{formatPrice(change, order.currency)}</span>
              </span>
            ) : null}
          </span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2" data-testid="order-rider">
        <span className="flex items-center gap-1.5">
          <BikeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {order.rider ? (
            <span>
              Repartidor: <span className="font-medium">{order.rider.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Sin repartidor</span>
          )}
        </span>
        {canAssignRider && !isFinalStatus(order.status) ? (
          <Button size="sm" variant="outline" disabled={disabled} onClick={onAssignRider}>
            {order.rider ? "Cambiar" : "Asignar repartidor"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
