"use client";

import {
  ORDER_LIMITS,
  type OrderView,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  PICKUP_READY_MINUTES,
  type PickupReadyMinutes,
} from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { BanknoteIcon, CreditCardIcon, LandmarkIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatClockTime } from "@/lib/format";
import { formatPrice } from "@/lib/money";
import { QUICK_REJECT_REASONS } from "@/lib/orders-board";
import { type RejectValues, rejectSchema } from "@/lib/validation";

/** Rejecting needs a reason the customer will read: quick reasons plus free text. */
export function RejectDialog({
  order,
  pending,
  onOpenChange,
  onReject,
}: {
  /** null = closed. */
  order: OrderView | null;
  pending: boolean;
  onOpenChange(open: boolean): void;
  onReject(reason: string): void;
}) {
  return (
    <Dialog open={order !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        {order ? <RejectForm key={order.id} order={order} pending={pending} onCancel={() => onOpenChange(false)} onReject={onReject} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RejectForm({
  order,
  pending,
  onCancel,
  onReject,
}: {
  order: OrderView;
  pending: boolean;
  onCancel(): void;
  onReject(reason: string): void;
}) {
  const form = useForm<RejectValues>({ resolver: zodResolver(rejectSchema), defaultValues: { reason: "" } });
  const { errors } = form.formState;
  return (
    <form noValidate onSubmit={form.handleSubmit((values) => onReject(values.reason))} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Rechazar pedido #{order.ticketNumber}</DialogTitle>
        <DialogDescription>El cliente verá el motivo en su teléfono.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Motivos rápidos">
        {QUICK_REJECT_REASONS.map((reason) => (
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
      <FormField id="reject-reason" label="Motivo" error={errors.reason?.message}>
        {(control) => <Textarea {...control} rows={2} maxLength={ORDER_LIMITS.rejectReasonMax} {...form.register("reason")} />}
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Volver
        </Button>
        <SubmitButton variant="destructive" pending={pending}>
          Rechazar pedido
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

const METHOD_ICONS: Record<PaymentMethod, typeof BanknoteIcon> = {
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
 * Accepting a pickup order: the staff say in how many minutes it will be ready (the customer sees the time).
 * The chips behave as a radio group; nothing is sent until "Aceptar pedido".
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
  onAccept(minutes: PickupReadyMinutes): void;
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
  onAccept(minutes: PickupReadyMinutes): void;
}) {
  const [minutes, setMinutes] = useState<PickupReadyMinutes | null>(null);
  const labelId = useId();
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
        <DialogDescription>¿En cuánto tiempo estará listo para retirar? El cliente verá la hora.</DialogDescription>
      </DialogHeader>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-3 gap-2">
        <span id={labelId} className="sr-only">
          Minutos hasta que esté listo
        </span>
        {PICKUP_READY_MINUTES.map((option) => {
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
            Listo aprox. a las <strong className="text-foreground">{preview}</strong>
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
 * "Entregar" on an unpaid order. Handing it over is allowed, but the staff are warned first: owner and
 * cashier can register the payment right there (and hand over in one go); kitchen can only hand over anyway
 * or go back (it cannot register payments).
 */
export function HandOverDialog({
  order,
  canPay,
  pending,
  onOpenChange,
  onPayAndHandOver,
  onHandOver,
}: {
  order: OrderView | null;
  canPay: boolean;
  /** Payment method being saved, "handover" while handing over without paying, or null. */
  pending: PaymentMethod | "handover" | null;
  onOpenChange(open: boolean): void;
  onPayAndHandOver(method: PaymentMethod): void;
  onHandOver(): void;
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
            {canPay ? (
              <div className="flex flex-col gap-2" role="group" aria-labelledby="handover-pay-title">
                <p id="handover-pay-title" className="text-sm font-medium">
                  Registrar pago y entregar
                </p>
                {PAYMENT_METHODS.map((method) => {
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
                Entregar sin pagar
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
