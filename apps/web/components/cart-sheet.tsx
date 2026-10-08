"use client";

import { CircleAlertIcon, ShoppingBagIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { type CartLine, lineTotal } from "@/lib/cart";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Cart pieces shared by the table page (/m/[token]) and the pickup menu (/r/[slug]); each page brings its
 * own checkout form (dine-in asks for an optional name, pickup for name and phone).
 */

/** A cart line the api refused (sold out, removed from the menu, invalid options). */
export interface LineProblem {
  productId: string;
  message: string;
}

/** Bottom sheet "Tu pedido" with the empty state; `children` is the checkout form. */
export function CartSheet({
  open,
  onOpenChange,
  submitting,
  description,
  empty,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** While true the sheet cannot be closed (the order is being sent). */
  submitting: boolean;
  description: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl sm:max-w-lg">
        <SheetHeader className="pr-12">
          <SheetTitle className="text-xl font-bold">Tu pedido</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {empty ? (
          <div className="flex flex-col items-center gap-2 px-4 pt-4 pb-10 text-center text-muted-foreground">
            <ShoppingBagIcon className="size-8" aria-hidden />
            <p>Tu pedido está vacío. Elige algo del menú.</p>
          </div>
        ) : (
          children
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Lines with quantity steppers, the refused-line warning and the estimated total. */
export function CartLines({
  lines,
  currency,
  total,
  problem,
  onQuantity,
  onRemove,
  onRemoveProduct,
}: {
  lines: CartLine[];
  currency: string;
  total: number;
  problem: LineProblem | null;
  onQuantity(key: string, quantity: number): void;
  onRemove(key: string): void;
  onRemoveProduct(productId: string): void;
}) {
  return (
    <>
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
    </>
  );
}

/** Fixed bar "Ver pedido (3) · $12.000" shown while the cart has something. */
export function CartBar({ count, total, currency, onOpen }: { count: number; total: number; currency: string; onOpen(): void }) {
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto max-w-3xl">
        <Button size="lg" className="h-12 w-full justify-between text-base" onClick={onOpen} aria-haspopup="dialog">
          <span className="flex items-center gap-2">
            <ShoppingBagIcon aria-hidden />
            Ver pedido ({count})
          </span>
          <span className="tabular-nums">{formatPrice(total, currency)}</span>
        </Button>
      </div>
    </div>
  );
}
