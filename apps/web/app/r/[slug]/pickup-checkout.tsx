"use client";

import { ORDER_LIMITS } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { CartLines, CartSheet, type LineProblem } from "@/components/cart-sheet";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { SheetFooter } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { type CartLine, cartTotal } from "@/lib/cart";
import { hasCode } from "@/lib/errors";
import { formatPrice } from "@/lib/money";
import { type PickupCheckoutValues, pickupCheckoutSchema } from "@/lib/validation";

interface PickupCartSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  lines: CartLine[];
  currency: string;
  restaurantName: string;
  canOrder: boolean;
  /** Why ordering is not possible right now (shown under the disabled button). */
  closedMessage: string;
  submitting: boolean;
  /** Error not tied to a line (closed restaurant, too many orders, network, validation). */
  error: unknown;
  problem: LineProblem | null;
  checkout: PickupCheckoutValues;
  onCheckoutChange(values: PickupCheckoutValues): void;
  onQuantity(key: string, quantity: number): void;
  onRemove(key: string): void;
  onRemoveProduct(productId: string): void;
  onSubmit(values: PickupCheckoutValues): void;
}

/** Cart review and pickup checkout: lines, name, phone, optional email and comment, "Pedir para retirar". */
export function PickupCartSheet(props: PickupCartSheetProps) {
  return (
    <CartSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      submitting={props.submitting}
      description={`Para retirar en ${props.restaurantName} · revisa antes de enviar.`}
      empty={props.lines.length === 0}
    >
      <PickupCheckout {...props} />
    </CartSheet>
  );
}

function PickupCheckout({
  lines,
  currency,
  canOrder,
  closedMessage,
  submitting,
  error,
  problem,
  checkout,
  onCheckoutChange,
  onQuantity,
  onRemove,
  onRemoveProduct,
  onSubmit,
}: PickupCartSheetProps) {
  const form = useForm<PickupCheckoutValues>({ resolver: zodResolver(pickupCheckoutSchema), defaultValues: checkout });
  const { errors } = form.formState;
  const total = cartTotal(lines);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
      // Keeps the contact data when the sheet is closed and reopened.
      onChange={() => onCheckoutChange(form.getValues())}
      className="flex flex-col"
      aria-label="Pedir para retirar"
    >
      <CartLines
        lines={lines}
        currency={currency}
        total={total}
        problem={problem}
        onQuantity={onQuantity}
        onRemove={onRemove}
        onRemoveProduct={onRemoveProduct}
      />
      <p className="px-4 text-xs text-muted-foreground">
        El local confirma tu pedido y te dice a qué hora estará listo. Pagas al retirar.
      </p>

      <div className="flex flex-col gap-4 px-4 pt-4">
        <FormField id="pickup-name" label="Tu nombre" error={errors.customerName?.message} description="Lo dices al retirar.">
          {(control) => (
            <Input
              {...control}
              autoComplete="name"
              maxLength={ORDER_LIMITS.customerNameMax}
              aria-required
              {...form.register("customerName")}
            />
          )}
        </FormField>
        <FormField
          id="pickup-phone"
          label="Teléfono"
          error={errors.customerPhone?.message}
          description="Para avisarte si hay algún problema con tu pedido."
        >
          {(control) => (
            <Input
              {...control}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+56 9 1234 5678"
              maxLength={30}
              aria-required
              {...form.register("customerPhone")}
            />
          )}
        </FormField>
        <FormField
          id="pickup-email"
          label="Correo (opcional)"
          error={errors.customerEmail?.message}
          description="Te enviamos el comprobante cuando el local acepte tu pedido."
        >
          {(control) => (
            <Input
              {...control}
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={ORDER_LIMITS.customerEmailMax}
              {...form.register("customerEmail")}
            />
          )}
        </FormField>
        <FormField id="pickup-note" label="Comentario para el local (opcional)" error={errors.note?.message}>
          {(control) => <Textarea {...control} rows={2} maxLength={ORDER_LIMITS.noteMax} {...form.register("note")} />}
        </FormField>
      </div>

      <SheetFooter className="sticky bottom-0 mt-2 border-t bg-popover">
        <FormError error={error}>
          {hasCode(error, "TOO_MANY_ACTIVE_ORDERS") ? (
            <Link href="/pedido" className="mt-1 inline-block font-medium underline underline-offset-4">
              Ver mis pedidos
            </Link>
          ) : null}
        </FormError>
        <SubmitButton size="lg" pending={submitting} disabled={!canOrder || problem !== null}>
          Pedir para retirar · {formatPrice(total, currency)}
        </SubmitButton>
        {!canOrder ? <p className="text-center text-sm text-muted-foreground">{closedMessage}</p> : null}
      </SheetFooter>
    </form>
  );
}
