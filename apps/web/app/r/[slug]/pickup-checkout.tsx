"use client";

import { MESSAGE_CHANNEL_LABELS, type MessageChannel, ORDER_LIMITS, type SavedAddressView } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { type Resolver, type UseFormRegisterReturn, useForm } from "react-hook-form";
import { AccountHint, type AccountHintProps } from "@/components/account-hint";
import { CartLines, type LineProblem } from "@/components/cart-sheet";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { PhoneInput } from "@/components/phone-input";
import { SubmitButton } from "@/components/submit-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetFooter } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { type CartLine, cartCount, cartTotal } from "@/lib/cart";
import { hasCode } from "@/lib/errors";
import { formatPrice } from "@/lib/money";
import { type PickupCheckoutValues, pickupCheckoutSchemaFor } from "@/lib/validation";

/** The visitor's account at checkout (phase 6): guests get a login link, customers their saved data. */
export interface CheckoutAccount extends AccountHintProps {
  /** Delivery: the customer's saved addresses (null: guest, still loading, or failed to load). */
  addresses: SavedAddressView[] | null;
  /** Delivery: "Guardar esta dirección en mi cuenta" is checked (saved after the order goes through). */
  saveAddress: boolean;
  onSaveAddressChange(save: boolean): void;
}

/** What both checkout forms (pickup and delivery) receive from the ordering page. */
export interface CheckoutFormProps {
  account: CheckoutAccount;
  lines: CartLine[];
  currency: string;
  /** The restaurant's `maxItemsPerOrder`: a cart above it cannot be sent. */
  maxItems: number;
  canOrder: boolean;
  /** Why ordering is not possible right now (shown under the disabled button). */
  closedMessage: string;
  submitting: boolean;
  /** Error not tied to a line (closed restaurant, too many orders, network, validation). */
  error: unknown;
  problem: LineProblem | null;
  onQuantity(key: string, quantity: number): void;
  onRemove(key: string): void;
  onRemoveProduct(productId: string): void;
  /** WhatsApp/SMS notices the restaurant offers (phase 8), and whether the customer asked for them. */
  notify: NotifyOption | null;
}

/** "Avísame por WhatsApp": offered when the restaurant sends notices; the phone field is the destination. */
export interface NotifyOption {
  channel: MessageChannel;
  checked: boolean;
  onChange(checked: boolean): void;
}

/** Pickup form: lines, name, phone, optional email and comment, "Pedir para retirar". */
export function PickupCheckout({
  account,
  lines,
  currency,
  maxItems,
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
  notify,
}: CheckoutFormProps & {
  checkout: PickupCheckoutValues;
  onCheckoutChange(values: PickupCheckoutValues): void;
  onSubmit(values: PickupCheckoutValues): void;
}) {
  // The mobile-phone rule depends on the notices checkbox; react-hook-form keeps the resolver it got first,
  // so it reads the current schema through a ref (same as the delivery form).
  const schema = useMemo(() => pickupCheckoutSchemaFor(notify?.checked ?? false), [notify?.checked]);
  const schemaRef = useRef(schema);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);
  const resolver = useMemo<Resolver<PickupCheckoutValues>>(
    () => (values, context, options) => zodResolver(schemaRef.current)(values, context, options),
    [],
  );
  const form = useForm<PickupCheckoutValues>({ resolver, defaultValues: checkout });
  const { errors } = form.formState;
  const total = cartTotal(lines);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
      // Keeps the contact data when the sheet is closed and reopened (or the channel changes).
      onChange={() => onCheckoutChange(form.getValues())}
      className="flex flex-col"
      aria-label="Pedir para retirar"
    >
      <CartLines
        lines={lines}
        currency={currency}
        total={total}
        maxItems={maxItems}
        problem={problem}
        onQuantity={onQuantity}
        onRemove={onRemove}
        onRemoveProduct={onRemoveProduct}
      />
      <p className="px-4 text-xs text-muted-foreground">
        El local confirma tu pedido y te dice a qué hora estará listo. Pagas al retirar.
      </p>

      <div className="flex flex-col gap-4 px-4 pt-4">
        <AccountHint account={account} />
        <ContactFields
          idPrefix="pickup"
          nameDescription="Lo dices al retirar."
          register={{
            customerName: form.register("customerName"),
            customerPhone: form.register("customerPhone"),
            customerEmail: form.register("customerEmail"),
          }}
          errors={{
            customerName: errors.customerName?.message,
            customerPhone: errors.customerPhone?.message,
            customerEmail: errors.customerEmail?.message,
          }}
          notify={notify}
        />
        <NoteField id="pickup-note" register={form.register("note")} error={errors.note?.message} />
      </div>

      <CheckoutFooter error={error} pending={submitting} disabled={!canOrder || problem !== null || cartCount(lines) > maxItems} closedMessage={canOrder ? null : closedMessage}>
        Pedir para retirar · {formatPrice(total, currency)}
      </CheckoutFooter>
    </form>
  );
}

type ContactField = "customerName" | "customerPhone" | "customerEmail";

/** Name, phone and optional email: the same fields (and rules) for pickup and delivery. */
export function ContactFields({
  idPrefix,
  nameDescription,
  register,
  errors,
  notify,
}: {
  idPrefix: string;
  nameDescription: string;
  register: { [K in ContactField]: UseFormRegisterReturn<K> };
  errors: { [K in ContactField]?: string };
  notify?: NotifyOption | null;
}) {
  return (
    <>
      <FormField id={`${idPrefix}-name`} label="Tu nombre" error={errors.customerName} description={nameDescription}>
        {(control) => (
          <Input {...control} autoComplete="name" maxLength={ORDER_LIMITS.customerNameMax} aria-required {...register.customerName} />
        )}
      </FormField>
      <FormField
        id={`${idPrefix}-phone`}
        label="Teléfono"
        error={errors.customerPhone}
        description="Para avisarte si hay algún problema con tu pedido."
      >
        {(control) => (
          <PhoneInput {...control} maxLength={30} aria-required {...register.customerPhone} />
        )}
      </FormField>
      {notify ? (
        <div className="flex items-start gap-3 rounded-lg bg-muted/60 p-3" data-testid="notify-option">
          <Checkbox
            id={`${idPrefix}-notify`}
            checked={notify.checked}
            onCheckedChange={(checked) => notify.onChange(checked === true)}
            aria-describedby={`${idPrefix}-notify-help`}
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor={`${idPrefix}-notify`}>Avísame por {MESSAGE_CHANNEL_LABELS[notify.channel]} a este número</Label>
            <p id={`${idPrefix}-notify-help`} className="text-sm text-muted-foreground">
              Te escribimos cuando el local acepte tu pedido y cuando esté listo o salga a reparto. Solo celulares.
            </p>
          </div>
        </div>
      ) : null}
      <FormField
        id={`${idPrefix}-email`}
        label="Correo (opcional)"
        error={errors.customerEmail}
        description="Te enviamos el comprobante cuando el local acepte tu pedido."
      >
        {(control) => (
          <Input
            {...control}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={ORDER_LIMITS.customerEmailMax}
            {...register.customerEmail}
          />
        )}
      </FormField>
    </>
  );
}

export function NoteField({ id, register, error }: { id: string; register: UseFormRegisterReturn<"note">; error?: string }) {
  return (
    <FormField id={id} label="Comentario para el local (opcional)" error={error}>
      {(control) => <Textarea {...control} rows={2} maxLength={ORDER_LIMITS.noteMax} {...register} />}
    </FormField>
  );
}

/** Sticky footer: api error (with "Ver mis pedidos" on too many orders), submit, and why it is disabled. */
export function CheckoutFooter({
  error,
  pending,
  disabled,
  closedMessage,
  children,
}: {
  error: unknown;
  pending: boolean;
  disabled: boolean;
  /** Shown under the button when the restaurant does not take orders right now. */
  closedMessage: string | null;
  children: ReactNode;
}) {
  return (
    <SheetFooter className="sticky bottom-0 mt-2 border-t bg-popover">
      <FormError error={error}>
        {hasCode(error, "TOO_MANY_ACTIVE_ORDERS") ? (
          <Link href="/pedido" className="mt-1 inline-block font-medium underline underline-offset-4">
            Ver mis pedidos
          </Link>
        ) : null}
      </FormError>
      <SubmitButton size="lg" pending={pending} disabled={disabled}>
        {children}
      </SubmitButton>
      {closedMessage ? <p className="text-center text-sm text-muted-foreground">{closedMessage}</p> : null}
    </SheetFooter>
  );
}
