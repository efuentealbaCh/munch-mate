"use client";

import { ORDER_LIMITS, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PublicDeliveryZone } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon, CloudOffIcon, MapPinOffIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { type Resolver, useForm, useWatch } from "react-hook-form";
import { CartLines } from "@/components/cart-sheet";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { PriceInput } from "@/components/price-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cartTotal } from "@/lib/cart";
import { cashChange, defaultZoneId, deliveryTotals, zoneOptionLabel } from "@/lib/delivery";
import { formatPrice, parsePriceInput } from "@/lib/money";
import { type DeliveryCheckoutValues, deliveryCheckoutSchema } from "@/lib/validation";
import { CheckoutFooter, type CheckoutFormProps, ContactFields, NoteField } from "./pickup-checkout";

/** Zones as the ordering page loaded them: null while loading. */
export interface ZonesState {
  zones: PublicDeliveryZone[] | null;
  error: unknown;
  retry(): void;
}

/**
 * Delivery form: lines with subtotal/shipping/total, contact data, zone (the restaurant's own preselected)
 * with its fee and minimum, address, and how the customer pays (cash with an optional amount to get change).
 */
export function DeliveryCheckout({
  zones: zonesState,
  ...props
}: CheckoutFormProps & {
  zones: ZonesState;
  checkout: DeliveryCheckoutValues;
  onCheckoutChange(values: DeliveryCheckoutValues): void;
  onSubmit(values: DeliveryCheckoutValues): void;
}) {
  const { zones, error, retry } = zonesState;
  if (!zones) {
    if (error) {
      return (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center" role="alert">
          <CloudOffIcon className="size-8 text-muted-foreground" aria-hidden />
          <FormError error={error} />
          <Button variant="outline" onClick={retry}>
            Reintentar
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3 px-4 py-4" aria-busy="true" aria-label="Cargando zonas de reparto">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (zones.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground" role="status">
        <MapPinOffIcon className="size-8" aria-hidden />
        <p>Este local todavía no tiene zonas de reparto configuradas.</p>
      </div>
    );
  }
  return <DeliveryForm zones={zones} {...props} />;
}

function DeliveryForm({
  zones,
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
}: CheckoutFormProps & {
  zones: PublicDeliveryZone[];
  checkout: DeliveryCheckoutValues;
  onCheckoutChange(values: DeliveryCheckoutValues): void;
  onSubmit(values: DeliveryCheckoutValues): void;
}) {
  const subtotal = cartTotal(lines);
  // Amount rules (minimum, cash covers the total) depend on the cart and the zones: rebuilt when they change,
  // read through a ref because react-hook-form keeps the resolver it got first.
  const schema = useMemo(() => deliveryCheckoutSchema({ subtotal, zones, currency }), [subtotal, zones, currency]);
  const schemaRef = useRef(schema);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);
  const resolver = useMemo<Resolver<DeliveryCheckoutValues>>(
    () => (values, context, options) => zodResolver(schemaRef.current)(values, context, options),
    [],
  );
  const initialZone = zones.some((zone) => zone.id === checkout.zoneId) ? checkout.zoneId : defaultZoneId(zones);
  const form = useForm<DeliveryCheckoutValues>({ resolver, defaultValues: { ...checkout, zoneId: initialZone } });
  const { errors } = form.formState;
  const [zoneId, paymentMethod, cashText] = useWatch({ control: form.control, name: ["zoneId", "paymentMethod", "cashAmount"] });

  // The zone list was refreshed and the chosen one is gone (deactivated): fall back to the default.
  useEffect(() => {
    if (!zones.some((zone) => zone.id === form.getValues("zoneId"))) {
      form.setValue("zoneId", defaultZoneId(zones), { shouldValidate: form.formState.isSubmitted });
    }
  }, [zones, form]);

  const zone = zones.find((z) => z.id === zoneId) ?? null;
  const totals = deliveryTotals(subtotal, zone);
  const cashAmount = paymentMethod === "cash" ? parsePriceInput(cashText) : null;
  const change = cashChange(totals.total, cashAmount);
  const sync = () => onCheckoutChange(form.getValues());

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} onChange={sync} className="flex flex-col" aria-label="Pedir delivery">
      <CartLines
        lines={lines}
        currency={currency}
        total={totals.total}
        fee={{ label: zone ? `Envío a ${zone.name}` : "Envío", amount: totals.fee }}
        problem={problem}
        onQuantity={onQuantity}
        onRemove={onRemove}
        onRemoveProduct={onRemoveProduct}
      />
      <p className="px-4 text-xs text-muted-foreground">
        El local confirma tu pedido y te dice a qué hora llega. Pagas al recibir.
      </p>

      <div className="flex flex-col gap-4 px-4 pt-4">
        <ContactFields
          idPrefix="delivery"
          nameDescription="Para quien recibe el pedido."
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
        />

        <fieldset className="flex flex-col gap-4 border-t pt-4">
          <legend className="float-left font-semibold">¿Dónde lo llevamos?</legend>
          <FormField
            id="delivery-zone"
            label="Comuna o zona"
            error={errors.zoneId?.message}
            description={
              zone
                ? `Envío ${zone.fee > 0 ? formatPrice(zone.fee, currency) : "gratis"}${
                    zone.minOrder > 0 ? ` · pedido mínimo ${formatPrice(zone.minOrder, currency)} (sin envío)` : ""
                  }`
                : undefined
            }
          >
            {(control) => (
              <NativeSelect {...control} aria-required {...form.register("zoneId", { onChange: sync })}>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {zoneOptionLabel(z, currency)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {zone && totals.missing > 0 ? (
            <p
              className="flex items-start gap-2 rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground"
              role="status"
              data-testid="below-minimum"
            >
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                El pedido mínimo para {zone.name} es {formatPrice(zone.minOrder, currency)} sin contar el envío. Agrega{" "}
                <strong>{formatPrice(totals.missing, currency)}</strong> más para pedir.
              </span>
            </p>
          ) : null}
          <FormField id="delivery-address" label="Calle y número" error={errors.address?.message}>
            {(control) => (
              <Input
                {...control}
                autoComplete="address-line1"
                placeholder="Ej. Av. Italia 1234"
                maxLength={ORDER_LIMITS.addressMax}
                aria-required
                {...form.register("address")}
              />
            )}
          </FormField>
          <FormField id="delivery-unit" label="Depto, casa u oficina (opcional)" error={errors.unit?.message}>
            {(control) => (
              <Input
                {...control}
                autoComplete="address-line2"
                placeholder="Ej. Depto 402"
                maxLength={ORDER_LIMITS.addressUnitMax}
                {...form.register("unit")}
              />
            )}
          </FormField>
          <FormField
            id="delivery-reference"
            label="Referencia (opcional)"
            error={errors.reference?.message}
            description="Ayuda al repartidor a encontrarte."
          >
            {(control) => (
              <Input
                {...control}
                autoComplete="off"
                placeholder="Ej. portón verde, frente a la plaza"
                maxLength={ORDER_LIMITS.addressReferenceMax}
                {...form.register("reference")}
              />
            )}
          </FormField>
        </fieldset>

        <fieldset
          className="flex flex-col gap-3 border-t pt-4"
          aria-describedby={errors.paymentMethod ? "delivery-payment-error" : undefined}
        >
          <legend className="float-left font-semibold">¿Cómo vas a pagar?</legend>
          <p className="clear-left -mt-2 text-sm text-muted-foreground">Pagas al recibir el pedido.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PAYMENT_METHODS.map((method) => (
              <label
                key={method}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium transition-colors has-checked:border-primary has-checked:bg-brand-soft has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="radio"
                  value={method}
                  className="size-4 accent-primary"
                  aria-invalid={errors.paymentMethod ? true : undefined}
                  {...form.register("paymentMethod", { onChange: sync })}
                />
                {PAYMENT_METHOD_LABELS[method]}
              </label>
            ))}
          </div>
          {errors.paymentMethod ? (
            <p id="delivery-payment-error" className="text-sm text-destructive" role="alert">
              {errors.paymentMethod.message}
            </p>
          ) : null}
          {paymentMethod === "cash" ? (
            <FormField
              id="delivery-cash"
              label="¿Con cuánto pagas? (opcional)"
              error={errors.cashAmount?.message}
              description="Así el repartidor lleva el vuelto justo."
            >
              {(control) => <PriceInput {...control} placeholder="Ej. 20.000" {...form.register("cashAmount")} />}
            </FormField>
          ) : null}
          {paymentMethod === "cash" && change !== null ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm" aria-live="polite" data-testid="cash-change">
              {change > 0 ? (
                <>
                  Tu vuelto: <strong className="tabular-nums">{formatPrice(change, currency)}</strong>
                </>
              ) : (
                "Pagas el monto exacto."
              )}
            </p>
          ) : null}
        </fieldset>

        <NoteField id="delivery-note" register={form.register("note")} error={errors.note?.message} />
      </div>

      <CheckoutFooter
        error={error}
        pending={submitting}
        disabled={!canOrder || problem !== null || !zone || totals.missing > 0}
        closedMessage={canOrder ? null : closedMessage}
      >
        Pedir delivery · {formatPrice(totals.total, currency)}
      </CheckoutFooter>
    </form>
  );
}
