"use client";

import type { OrderStatus, OrderView } from "@app/types";
import { formatPhone } from "@app/utils";
import {
  AlarmClockIcon,
  BikeIcon,
  ChevronDownIcon,
  ClockIcon,
  DownloadIcon,
  MailIcon,
  MapPinIcon,
  MessageSquareTextIcon,
  MonitorSmartphoneIcon,
  NavigationIcon,
  PencilIcon,
  PhoneIcon,
  PrinterIcon,
  ShoppingBagIcon,
  UserIcon,
  WalletIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { formatClockTime, telHref } from "@/lib/format";
import { formatPrice, formatPriceDelta } from "@/lib/money";
import { addressLine, expectedPaymentLabel, mapsSearchUrl } from "@/lib/delivery";
import { estimateLabel, showsReadyEstimate } from "@/lib/order-tracking";
import { ACTION_LABELS, destinationLabel, elapsedLabel, isFinalStatus, isPastReadyTime, minutesSince } from "@/lib/orders-board";
import { paymentBadgeLabel } from "@/lib/split-bill";
import { cn } from "@/lib/utils";

/** Paid with its method (each portion when a split table account paid it with several), or "Sin pagar". */
export function PaymentBadge({ order }: { order: OrderView }) {
  return order.paymentStatus === "paid" ? (
    <Badge variant="secondary" className="h-auto bg-success/10 whitespace-normal text-success" data-testid="payment-badge">
      {paymentBadgeLabel(order)}
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
  /**
   * «Comanda»: prints the kitchen ticket, on the print agent's kitchen printer when the restaurant has one,
   * else on this device's receipt printer (phase 8).
   */
  onPrint?(): void;
  /** Passed while «Comanda» goes to the print agent: «Imprimir en este dispositivo» forces the browser. */
  onPrintHere?(): void;
  /** The ticket is being sent to the print agent. */
  printBusy?: boolean;
  /** "Modificar": change the items (only passed while this member may edit the order). */
  onEdit?(): void;
  /** Just arrived: highlighted for a few seconds. */
  fresh: boolean;
  /** Opened from En vivo («Ver en Pedidos»): highlighted and focused for a few seconds. */
  highlighted?: boolean;
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
  /** Delivery on its way with a rider, and the base map is available: "Seguir al repartidor". */
  onTrackRider?(): void;
}

/** DOM id of an order's card on the board (and of its row in «Hoy»), to scroll to and focus it. */
export function orderCardId(orderId: string): string {
  return `order-card-${orderId}`;
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
  onPrint,
  onPrintHere,
  printBusy = false,
  onEdit,
  fresh,
  highlighted = false,
  busy,
  onAction,
  onPay,
  receiptBusy,
  onReceipt,
  canAssignRider,
  onAssignRider,
  onTrackRider,
}: OrderCardProps) {
  const minutes = now ? minutesSince(order.createdAt, now) : 0;
  const forward = actions.filter((status) => status !== "rejected" && status !== "cancelled");
  const backward = actions.filter((status) => status === "rejected" || status === "cancelled");
  const disabled = busy !== null;

  return (
    <article
      id={orderCardId(order.id)}
      // Focusable by script only (the board scrolls to it), not a tab stop.
      tabIndex={-1}
      aria-labelledby={`order-${order.id}`}
      className={cn(
        "flex scroll-mt-24 flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow outline-none",
        fresh && "animate-in ring-2 ring-primary fade-in-0 slide-in-from-top-2 duration-500",
        highlighted && "shadow-lg ring-4 ring-primary",
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
          {order.edits.length > 0 ? (
            <Badge variant="outline" className="border-warning-foreground/40 bg-warning text-warning-foreground" data-testid="order-edited">
              Modificado
            </Badge>
          ) : null}
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
        <DeliveryBlock
          order={order}
          canAssignRider={canAssignRider}
          disabled={disabled}
          onAssignRider={onAssignRider}
          onTrackRider={order.status === "out_for_delivery" && order.rider ? onTrackRider : undefined}
        />
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

      {order.edits.length > 0 ? <EditHistory order={order} /> : null}

      {order.note ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-warning px-2 py-1.5 text-sm text-warning-foreground">
          <MessageSquareTextIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          {order.note}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
        <span className="flex flex-col">
          <span className="font-bold tabular-nums" data-testid="order-total">
            {formatPrice(order.total, order.currency)}
          </span>
          {order.deliveryFee > 0 ? (
            <span className="text-xs text-muted-foreground">incluye envío {formatPrice(order.deliveryFee, order.currency)}</span>
          ) : null}
        </span>
        <PaymentBadge order={order} />
      </div>

      {forward.length > 0 || backward.length > 0 || (canPay && order.paymentStatus === "unpaid") || order.receiptAvailable || onPrint || onEdit ? (
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
            {onPrint ? (
              <div className="flex flex-1">
                <Button
                  variant="outline"
                  className={cn("flex-1", onPrintHere && "rounded-r-none")}
                  onClick={onPrint}
                  disabled={printBusy}
                  aria-busy={printBusy || undefined}
                  aria-label={`Imprimir comanda del pedido #${order.ticketNumber}`}
                  data-testid="print-order"
                >
                  {printBusy ? <Spinner aria-hidden data-icon="inline-start" /> : <PrinterIcon aria-hidden data-icon="inline-start" />}
                  Comanda
                </Button>
                {onPrintHere ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="-ml-px rounded-l-none"
                        aria-label={`Más opciones de impresión del pedido #${order.ticketNumber}`}
                      >
                        <ChevronDownIcon aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-60">
                      <DropdownMenuItem className="min-h-10" onSelect={onPrintHere}>
                        <MonitorSmartphoneIcon aria-hidden />
                        Imprimir en este dispositivo
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            ) : null}
            {onEdit ? (
              <Button
                variant="outline"
                className="flex-1"
                disabled={disabled}
                onClick={onEdit}
                aria-label={`Modificar el pedido #${order.ticketNumber}`}
                data-testid="edit-order"
              >
                <PencilIcon aria-hidden data-icon="inline-start" />
                Modificar
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

/** Item edits by the staff, newest first, folded under one line ("Modificado 20:50 · Ana"). */
function EditHistory({ order }: { order: OrderView }) {
  const edits = [...order.edits].reverse();
  const last = edits[0];
  if (!last) return null;
  return (
    <details className="group rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm" data-testid="order-edits">
      <summary className="flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <PencilIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          Modificado {formatClockTime(last.at)}
          {last.byName ? ` · ${last.byName}` : ""}
          {edits.length > 1 ? <span className="font-normal text-muted-foreground"> ({edits.length} cambios)</span> : null}
        </span>
      </summary>
      <ol className="mt-1 flex flex-col gap-2 pb-1">
        {edits.map((edit, index) => (
          <li key={`${edit.at}-${index}`} className="flex flex-col">
            <span className="text-xs text-muted-foreground">
              {formatClockTime(edit.at)}
              {edit.byName ? ` · ${edit.byName}` : ""}
            </span>
            {edit.changes.map((change, changeIndex) => (
              <span key={`${change}-${changeIndex}`}>{change}</span>
            ))}
            {edit.reason ? <span className="text-muted-foreground italic">Motivo: {edit.reason}</span> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Address (with a map search), expected payment with the change to bring, and the rider. */
function DeliveryBlock({
  order,
  canAssignRider,
  disabled,
  onAssignRider,
  onTrackRider,
}: {
  order: OrderView;
  canAssignRider: boolean;
  disabled: boolean;
  onAssignRider(): void;
  onTrackRider?(): void;
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
            {/* An edit raised the total above the announced bill (the api then drops it): ask before leaving.
                Without edits a missing amount means the customer pays the exact total, as before. */}
            {order.expectedPayment.method === "cash" && order.expectedPayment.cashAmount === null && order.edits.length > 0 ? (
              <span className="mt-1 block font-bold text-foreground" data-testid="ask-cash-amount">
                Pregunta con cuánto paga
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
        <span className="flex flex-wrap items-center gap-1">
          {onTrackRider ? (
            <Button size="sm" variant="secondary" onClick={onTrackRider} data-testid="track-rider">
              <NavigationIcon aria-hidden data-icon="inline-start" />
              Seguir al repartidor
            </Button>
          ) : null}
          {canAssignRider && !isFinalStatus(order.status) ? (
            <Button size="sm" variant="outline" disabled={disabled} onClick={onAssignRider}>
              {order.rider ? "Cambiar" : "Asignar repartidor"}
            </Button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
