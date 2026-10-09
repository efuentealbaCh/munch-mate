"use client";

import {
  ORDER_LIMITS,
  type OrderView,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  PICKUP_READY_MINUTES,
  READY_MINUTES_BY_CHANNEL,
  type RiderView,
} from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { BanknoteIcon, BikeIcon, CheckIcon, CreditCardIcon, LandmarkIcon, TriangleAlertIcon, UserMinusIcon } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useApiQuery } from "@/hooks/use-api-query";
import { expectedPaymentLabel, methodsExpectedFirst } from "@/lib/delivery";
import { ordersApi } from "@/lib/endpoints";
import { formatClockTime } from "@/lib/format";
import { formatPrice } from "@/lib/money";
import { REASON_DIALOG_TEXTS, type ReasonStatus } from "@/lib/orders-board";
import { type StatusReasonValues, statusReasonSchema } from "@/lib/validation";

/**
 * Rejecting or cancelling (staff) needs a reason the customer will read: quick reasons plus free text.
 * Which transitions need it comes from the state machine (`actionStep` in lib/orders-board).
 */
export function ReasonDialog({
  order,
  status,
  pending,
  onOpenChange,
  onConfirm,
}: {
  /** null = closed. */
  order: OrderView | null;
  status: ReasonStatus;
  pending: boolean;
  onOpenChange(open: boolean): void;
  onConfirm(reason: string): void;
}) {
  return (
    <Dialog open={order !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        {order ? (
          <ReasonForm
            key={`${order.id}-${status}`}
            order={order}
            status={status}
            pending={pending}
            onCancel={() => onOpenChange(false)}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  order,
  status,
  pending,
  onCancel,
  onConfirm,
}: {
  order: OrderView;
  status: ReasonStatus;
  pending: boolean;
  onCancel(): void;
  onConfirm(reason: string): void;
}) {
  const form = useForm<StatusReasonValues>({ resolver: zodResolver(statusReasonSchema), defaultValues: { reason: "" } });
  const { errors } = form.formState;
  const texts = REASON_DIALOG_TEXTS[status];
  return (
    <form noValidate onSubmit={form.handleSubmit((values) => onConfirm(values.reason))} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {texts.title} #{order.ticketNumber}
        </DialogTitle>
        <DialogDescription>{texts.description}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Motivos rápidos">
        {texts.quickReasons.map((reason) => (
          <Button
            key={reason}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => form.setValue("reason", reason, { shouldValidate: true })}
          >
            {reason}
          </Button>
        ))}
      </div>
      <FormField id={`${status}-reason`} label="Motivo" error={errors.reason?.message}>
        {(control) => <Textarea {...control} rows={2} maxLength={ORDER_LIMITS.rejectReasonMax} {...form.register("reason")} />}
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Volver
        </Button>
        <SubmitButton variant="destructive" pending={pending}>
          {texts.submit}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

export const METHOD_ICONS: Record<PaymentMethod, typeof BanknoteIcon> = {
  cash: BanknoteIcon,
  card_pos: CreditCardIcon,
  transfer: LandmarkIcon,
};

/** Cash, card terminal or transfer: one tap registers it (the amount is the order total). */
export function PaymentDialog({
  order,
  pending,
  onOpenChange,
  onPay,
}: {
  order: OrderView | null;
  /** Method being saved, or null. */
  pending: PaymentMethod | null;
  onOpenChange(open: boolean): void;
  onPay(method: PaymentMethod): void;
}) {
  return (
    <Dialog open={order !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent className="sm:max-w-sm">
        {order ? (
          <>
            <DialogHeader>
              <DialogTitle>Registrar pago #{order.ticketNumber}</DialogTitle>
              <DialogDescription>
                Total {formatPrice(order.total, order.currency)}. ¿Cómo pagó?
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2" role="group" aria-label="Medio de pago">
              {PAYMENT_METHODS.map((method) => {
                const Icon = METHOD_ICONS[method];
                return (
                  <Button
                    key={method}
                    variant="outline"
                    size="lg"
                    className="justify-start"
                    disabled={pending !== null}
                    aria-busy={pending === method || undefined}
                    onClick={() => onPay(method)}
                  >
                    {pending === method ? <Spinner aria-hidden data-icon="inline-start" /> : <Icon aria-hidden data-icon="inline-start" />}
                    {PAYMENT_METHOD_LABELS[method]}
                  </Button>
                );
              })}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Accepting a pickup or delivery order: the staff say in how many minutes it will be ready (pickup) or arrive
 * (delivery); the customer sees the time. The choices come from READY_MINUTES_BY_CHANNEL. The chips behave as
 * a radio group; nothing is sent until "Aceptar pedido".
 */
export function ReadyTimeDialog({
  order,
  pending,
  now,
  onOpenChange,
  onAccept,
}: {
  /** null = closed. */
  order: OrderView | null;
  pending: boolean;
  /** Current time (ms) for the "listo aprox." preview; 0 hides it. */
  now: number;
  onOpenChange(open: boolean): void;
  onAccept(minutes: number): void;
}) {
  return (
    <Dialog open={order !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        {order ? (
          <ReadyTimeForm key={order.id} order={order} pending={pending} now={now} onCancel={() => onOpenChange(false)} onAccept={onAccept} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReadyTimeForm({
  order,
  pending,
  now,
  onCancel,
  onAccept,
}: {
  order: OrderView;
  pending: boolean;
  now: number;
  onCancel(): void;
  onAccept(minutes: number): void;
}) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const labelId = useId();
  const delivery = order.channel === "delivery";
  const options = READY_MINUTES_BY_CHANNEL[order.channel] ?? PICKUP_READY_MINUTES;
  const estimate = delivery ? "Llega aprox. a las" : "Listo aprox. a las";
  const preview = minutes && now ? formatClockTime(new Date(now + minutes * 60_000).toISOString()) : null;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (minutes) onAccept(minutes);
      }}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>Aceptar pedido #{order.ticketNumber}</DialogTitle>
        <DialogDescription>
          {delivery
            ? "¿En cuánto tiempo llega a la dirección del cliente? El cliente verá la hora."
            : "¿En cuánto tiempo estará listo para retirar? El cliente verá la hora."}
        </DialogDescription>
      </DialogHeader>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-3 gap-2">
        <span id={labelId} className="sr-only">
          {delivery ? "Minutos hasta que llegue" : "Minutos hasta que esté listo"}
        </span>
        {options.map((option) => {
          const checked = minutes === option;
          return (
            <Button
              key={option}
              type="button"
              role="radio"
              aria-checked={checked}
              variant={checked ? "default" : "outline"}
              size="lg"
              disabled={pending}
              onClick={() => setMinutes(option)}
            >
              {option} min
            </Button>
          );
        })}
      </div>
      <p className="min-h-5 text-center text-sm text-muted-foreground" aria-live="polite">
        {preview ? (
          <>
            {estimate} <strong className="text-foreground">{preview}</strong>
          </>
        ) : (
          "Elige un tiempo para continuar."
        )}
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Volver
        </Button>
        <SubmitButton pending={pending} disabled={minutes === null}>
          Aceptar pedido
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

/**
 * "Entregar"/"Entregado" on an unpaid order (pickup or delivery). Handing it over is allowed, but the staff
 * are warned first: owner, cashier (and the assigned rider) can register the payment right there and hand
 * over in one go; kitchen can only hand over anyway or go back (it cannot register payments). For delivery
 * the method the customer announced comes first, with the change to give.
 */
export function HandOverDialog({
  order,
  canPay,
  pending,
  onOpenChange,
  onPayAndHandOver,
  onHandOver,
  handOverLabel = "Entregar sin pagar",
}: {
  order: OrderView | null;
  canPay: boolean;
  /** Payment method being saved, "handover" while handing over without paying, or null. */
  pending: PaymentMethod | "handover" | null;
  onOpenChange(open: boolean): void;
  onPayAndHandOver(method: PaymentMethod): void;
  onHandOver(): void;
  /** Text of the "hand over without registering a payment" button. */
  handOverLabel?: string;
}) {
  const busy = pending !== null;
  return (
    <Dialog open={order !== null} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <DialogContent className="sm:max-w-sm">
        {order ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TriangleAlertIcon className="size-5 text-destructive" aria-hidden />
                Pedido #{order.ticketNumber} sin pagar
              </DialogTitle>
              <DialogDescription>
                Total {formatPrice(order.total, order.currency)}.{" "}
                {canPay ? "Registra cómo pagó y entrégalo, o entrégalo igual." : "Avísale a caja antes de entregarlo."}
              </DialogDescription>
            </DialogHeader>
            {order.expectedPayment ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm" data-testid="handover-expected-payment">
                El cliente dijo: <strong>{expectedPaymentLabel(order.expectedPayment, order.currency)}</strong>
              </p>
            ) : null}
            {canPay ? (
              <div className="flex flex-col gap-2" role="group" aria-labelledby="handover-pay-title">
                <p id="handover-pay-title" className="text-sm font-medium">
                  Registrar pago y entregar
                </p>
                {methodsExpectedFirst(PAYMENT_METHODS, order.expectedPayment?.method).map((method) => {
                  const Icon = METHOD_ICONS[method];
                  return (
                    <Button
                      key={method}
                      size="lg"
                      className="justify-start"
                      disabled={busy}
                      aria-busy={pending === method || undefined}
                      onClick={() => onPayAndHandOver(method)}
                    >
                      {pending === method ? <Spinner aria-hidden data-icon="inline-start" /> : <Icon aria-hidden data-icon="inline-start" />}
                      {PAYMENT_METHOD_LABELS[method]} y entregar
                    </Button>
                  );
                })}
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
                {canPay ? "Volver" : "Cancelar"}
              </Button>
              <Button variant="outline" disabled={busy} aria-busy={pending === "handover" || undefined} onClick={onHandOver}>
                {pending === "handover" ? <Spinner aria-hidden data-icon="inline-start" /> : null}
                {handOverLabel}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Assign (or change, or remove) the rider of a delivery order. Lists the members with the rider role,
 * loaded when the dialog opens. Owner and cashier only.
 */
export function RiderDialog({
  restaurantId,
  order,
  pending,
  onOpenChange,
  onAssign,
}: {
  restaurantId: string;
  order: OrderView | null;
  /** Rider id being saved, "none" while unassigning, or null. */
  pending: string | null;
  onOpenChange(open: boolean): void;
  onAssign(riderId: string | null): void;
}) {
  return (
    <Dialog open={order !== null} onOpenChange={(open) => pending === null && onOpenChange(open)}>
      <DialogContent className="sm:max-w-sm">
        {order ? (
          <RiderPicker
            key={order.id}
            restaurantId={restaurantId}
            order={order}
            pending={pending}
            onClose={() => onOpenChange(false)}
            onAssign={onAssign}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RiderPicker({
  restaurantId,
  order,
  pending,
  onClose,
  onAssign,
}: {
  restaurantId: string;
  order: OrderView;
  pending: string | null;
  onClose(): void;
  onAssign(riderId: string | null): void;
}) {
  const load = useCallback(() => ordersApi.riders(restaurantId), [restaurantId]);
  const { data: riders, error, loading, reload } = useApiQuery<RiderView[]>(load);
  const busy = pending !== null;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Repartidor del pedido #{order.ticketNumber}</DialogTitle>
        <DialogDescription>El repartidor verá este pedido en su pantalla de repartos.</DialogDescription>
      </DialogHeader>
      {error && !riders ? (
        <div className="flex flex-col items-start gap-3">
          <FormError error={error} />
          <Button variant="outline" onClick={reload}>
            Reintentar
          </Button>
        </div>
      ) : loading && !riders ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando repartidores">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : riders && riders.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          No hay repartidores en el equipo. El dueño puede invitar a alguien con el rol Repartidor desde Equipo.
        </p>
      ) : (
        <div className="flex flex-col gap-2" role="group" aria-label="Repartidores">
          {riders?.map((rider) => {
            const current = order.rider?.id === rider.id;
            return (
              <Button
                key={rider.id}
                size="lg"
                variant={current ? "secondary" : "outline"}
                className="justify-start"
                disabled={busy || current}
                aria-busy={pending === rider.id || undefined}
                onClick={() => onAssign(rider.id)}
              >
                {pending === rider.id ? (
                  <Spinner aria-hidden data-icon="inline-start" />
                ) : current ? (
                  <CheckIcon aria-hidden data-icon="inline-start" />
                ) : (
                  <BikeIcon aria-hidden data-icon="inline-start" />
                )}
                {rider.name}
                {current ? <span className="ml-auto text-xs font-normal text-muted-foreground">Asignado</span> : null}
              </Button>
            );
          })}
        </div>
      )}
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Volver
        </Button>
        {order.rider ? (
          <Button variant="outline" disabled={busy} aria-busy={pending === "none" || undefined} onClick={() => onAssign(null)}>
            {pending === "none" ? <Spinner aria-hidden data-icon="inline-start" /> : <UserMinusIcon aria-hidden data-icon="inline-start" />}
            Quitar repartidor
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}
