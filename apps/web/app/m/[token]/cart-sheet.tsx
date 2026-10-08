"use client";

import { ORDER_LIMITS } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { CartLines, CartSheet, type LineProblem } from "@/components/cart-sheet";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { SheetFooter } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { type CartLine, cartTotal } from "@/lib/cart";
import { formatPrice } from "@/lib/money";
import { type CheckoutValues, checkoutSchema } from "@/lib/validation";

interface TableCartSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  lines: CartLine[];
  currency: string;
  tableLabel: string;
  canOrder: boolean;
  /** Shown under the button while ordering is not possible (defaults to the closed-restaurant text). */
  closedMessage?: string;
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

/** Cart review and checkout from a table: lines, quantities, optional name and comment, "Enviar pedido". */
export function TableCartSheet(props: TableCartSheetProps) {
  return (
    <CartSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      submitting={props.submitting}
      description={`${props.tableLabel} · revisa antes de enviar.`}
      empty={props.lines.length === 0}
    >
      <TableCheckout {...props} />
    </CartSheet>
  );
}

function TableCheckout({
  lines,
  currency,
  canOrder,
  closedMessage = "El local no está recibiendo pedidos ahora.",
  submitting,
  error,
  problem,
  checkout,
  onCheckoutChange,
  onQuantity,
  onRemove,
  onRemoveProduct,
  onSubmit,
}: TableCartSheetProps) {
  const form = useForm<CheckoutValues>({ resolver: zodResolver(checkoutSchema), defaultValues: checkout });
  const { errors } = form.formState;
  const total = cartTotal(lines);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
      // Keeps name/comment when the sheet is closed and reopened.
      onChange={() => onCheckoutChange(form.getValues())}
      className="flex flex-col"
      aria-label="Enviar pedido"
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
          <p className="text-center text-sm text-muted-foreground">{closedMessage}</p>
        ) : null}
      </SheetFooter>
    </form>
  );
}
