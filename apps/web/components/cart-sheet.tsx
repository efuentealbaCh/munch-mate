"use client";

import { CircleAlertIcon, ShoppingBagIcon, Trash2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { type CartLine, itemLimit, itemLimitMessage, lineQuantityMax, lineTotal } from "@/lib/cart";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Cart pieces shared by the table page (/m/[token]) and the public menu (/r/[slug]); each page brings its
 * own checkout form (dine-in asks for an optional name, pickup for name and phone, delivery adds the address).
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

/**
 * Lines with quantity steppers, the refused-line warning and the estimated total. With `fee` (delivery) the
 * summary shows subtotal, shipping and total; `total` must then include the fee. Steppers stop at the
 * restaurant's units-per-order cap, with a notice once it is reached (or exceeded, which blocks the submit).
 */
export function CartLines({
  lines,
  currency,
  total,
  fee,
  maxItems,
  problem,
  onQuantity,
  onRemove,
  onRemoveProduct,
}: {
  lines: CartLine[];
  currency: string;
  total: number;
  /** Delivery fee of the chosen zone (label e.g. "Envío a Ñuñoa"); omitted for table and pickup orders. */
  fee?: { label: string; amount: number };
  /** The restaurant's `maxItemsPerOrder`. */
  maxItems: number;
  problem: LineProblem | null;
  onQuantity(key: string, quantity: number): void;
  onRemove(key: string): void;
  onRemoveProduct(productId: string): void;
}) {
  const limit = itemLimit(lines, maxItems);
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
                  max={lineQuantityMax(line, limit)}
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

      {limit.remaining === 0 ? <ItemLimitNotice count={limit.count} max={limit.max} className="mx-4 mt-1" /> : null}

      {fee ? (
        <dl className="flex flex-col gap-1 border-t px-4 pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums" data-testid="cart-subtotal">
              {formatPrice(total - fee.amount, currency)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{fee.label}</dt>
            <dd className="tabular-nums" data-testid="cart-fee">
              {fee.amount > 0 ? formatPrice(fee.amount, currency) : "Gratis"}
            </dd>
          </div>
        </dl>
      ) : null}
      <div className={cn("flex items-baseline justify-between px-4 py-3", !fee && "border-t")}>
        <span className="font-semibold">Total</span>
        <span className="text-xl font-bold tabular-nums" data-testid="cart-total">
          {formatPrice(total, currency)}
        </span>
      </div>
    </>
  );
}

/**
 * "Este local acepta hasta N productos por pedido": informative when the cart is full, an alert (and the
 * submit stays disabled) when it holds more than allowed.
 */
export function ItemLimitNotice({ count, max, className }: { count: number; max: number; className?: string }) {
  const exceeded = count > max;
  return (
    <p
      role={exceeded ? "alert" : "status"}
      data-testid="item-limit"
      className={cn(
        "flex items-start gap-1.5 rounded-lg px-3 py-2 text-sm",
        exceeded ? "bg-destructive/5 font-medium text-destructive ring-1 ring-destructive/30" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      {itemLimitMessage({ count, max })}
    </p>
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
