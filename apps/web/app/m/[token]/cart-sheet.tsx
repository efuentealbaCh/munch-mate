"use client";

import { ORDER_LIMITS } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlertIcon, ShoppingBagIcon, Trash2Icon } from "lucide-react";
import { useForm } from "react-hook-form";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { QuantityStepper } from "@/components/quantity-stepper";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { type CartLine, cartTotal, lineTotal } from "@/lib/cart";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import { type CheckoutValues, checkoutSchema } from "@/lib/validation";

/** A cart line the api refused (sold out, removed from the menu, invalid options). */
export interface LineProblem {
  productId: string;
  message: string;
}

interface CartSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  lines: CartLine[];
  currency: string;
  tableLabel: string;
  canOrder: boolean;
  submitting: boolean;
  /** Error not tied to a line (closed restaurant, network, validation). */
  error: unknown;
  problem: LineProblem | null;
  checkout: CheckoutValues;
  onCheckoutChange(values: CheckoutValues): void;
  onQuantity(key: string, quantity: number): void;
  onRemove(key: string): void;
  onRemoveProduct(productId: string): void;
  onSubmit(values: CheckoutValues): void;
}

/** Cart review and checkout: lines, quantities, optional name and comment, "Enviar pedido". */
export function CartSheet(props: CartSheetProps) {
  const { open, onOpenChange, lines, currency } = props;
  return (
    <Sheet open={open} onOpenChange={(next) => !props.submitting && onOpenChange(next)}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl sm:max-w-lg">
        <SheetHeader className="pr-12">
          <SheetTitle className="text-xl font-bold">Tu pedido</SheetTitle>
          <SheetDescription>{props.tableLabel} · revisa antes de enviar.</SheetDescription>
        </SheetHeader>
        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 pt-4 pb-10 text-center text-muted-foreground">
            <ShoppingBagIcon className="size-8" aria-hidden />
            <p>Tu pedido está vacío. Elige algo del menú.</p>
          </div>
        ) : (
          <CartContent {...props} total={cartTotal(lines)} currency={currency} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CartContent({
  lines,
  currency,
  canOrder,
  submitting,
  error,
  problem,
  checkout,
  onCheckoutChange,
  onQuantity,
  onRemove,
  onRemoveProduct,
  onSubmit,
  total,
}: CartSheetProps & { total: number }) {
  const form = useForm<CheckoutValues>({ resolver: zodResolver(checkoutSchema), defaultValues: checkout });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
      // Keeps name/comment when the sheet is closed and reopened.
      onChange={() => onCheckoutChange(form.getValues())}
      className="flex flex-col"
      aria-label="Enviar pedido"
    >
      <ul className="flex flex-col divide-y px-4" aria-label="Productos del pedido">
        {lines.map((line) => {
          const refused = problem?.productId === line.productId;
          return (
            <li
              key={line.key}
              className={cn("flex flex-col gap-2 py-3", refused && "-mx-2 rounded-lg bg-destructive/5 px-2 ring-1 ring-destructive/30")}
              data-testid="cart-line"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-semibold break-words">{line.name}</span>
                  {line.modifiers.length > 0 ? (
                    <span className="text-sm text-muted-foreground">
                      {line.modifiers.map((modifier) => modifier.optionName).join(" · ")}
                    </span>
                  ) : null}
                  {line.note ? <span className="text-sm text-muted-foreground italic">«{line.note}»</span> : null}
                </div>
                <span className="font-semibold tabular-nums">{formatPrice(lineTotal(line), currency)}</span>
              </div>
              {refused ? (
                <div className="flex flex-wrap items-center justify-between gap-2" role="alert">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                    <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
                    {problem.message}
                  </span>
                  <Button type="button" size="sm" variant="destructive" onClick={() => onRemoveProduct(line.productId)}>
                    Quitar del pedido
                  </Button>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <QuantityStepper
                  size="sm"
                  value={line.quantity}
                  onChange={(quantity) => onQuantity(line.key, quantity)}
                  label={`Cantidad de ${line.name}`}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(line.key)} aria-label={`Quitar ${line.name}`}>
                  <Trash2Icon aria-hidden data-icon="inline-start" />
                  Quitar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-baseline justify-between border-t px-4 py-3">
        <span className="font-semibold">Total</span>
        <span className="text-xl font-bold tabular-nums" data-testid="cart-total">
          {formatPrice(total, currency)}
        </span>
      </div>
      <p className="px-4 text-xs text-muted-foreground">El local confirma el total al recibir tu pedido. Pagas en el local.</p>

      <div className="flex flex-col gap-4 px-4 pt-4">
        <FormField id="checkout-name" label="Tu nombre (opcional)" error={errors.customerName?.message} description="Para que te encuentren al servir.">
          {(control) => (
            <Input
              {...control}
              autoComplete="given-name"
              maxLength={ORDER_LIMITS.customerNameMax}
              {...form.register("customerName")}
            />
          )}
        </FormField>
        <FormField id="checkout-note" label="Comentario para cocina (opcional)" error={errors.note?.message}>
          {(control) => <Textarea {...control} rows={2} maxLength={ORDER_LIMITS.noteMax} {...form.register("note")} />}
        </FormField>
      </div>

      <SheetFooter className="sticky bottom-0 mt-2 border-t bg-popover">
        <FormError error={error} />
        <SubmitButton size="lg" pending={submitting} disabled={!canOrder || problem !== null}>
          Enviar pedido · {formatPrice(total, currency)}
        </SubmitButton>
        {!canOrder ? (
          <p className="text-center text-sm text-muted-foreground">El local no está recibiendo pedidos ahora.</p>
        ) : null}
      </SheetFooter>
    </form>
  );
}
