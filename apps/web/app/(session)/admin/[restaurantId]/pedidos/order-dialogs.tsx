"use client";

import { ORDER_LIMITS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type OrderView, type PaymentMethod } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { BanknoteIcon, CreditCardIcon, LandmarkIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
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
