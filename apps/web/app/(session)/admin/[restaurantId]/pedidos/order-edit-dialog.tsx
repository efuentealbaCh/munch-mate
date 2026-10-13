"use client";

import { ORDER_LIMITS, type OrderItemView, type OrderView, type PublicMenu, type PublicProduct } from "@app/types";
import { CircleAlertIcon, PlusIcon, RefreshCwIcon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useCallback, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { ItemLimitNotice, type LineProblem } from "@/components/cart-sheet";
import { FormError } from "@/components/form-error";
import { OrderProductSheet } from "@/components/order-product-sheet";
import { QuantityStepper } from "@/components/quantity-stepper";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useApiQuery } from "@/hooks/use-api-query";
import { ApiError } from "@/lib/api";
import { blockedGroups, type CartLine, cartReducer, LINE_ERRORS, lineQuantityMax, lineTotal, maxFromMeta } from "@/lib/cart";
import { ordersApi, publicOrdersApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatPrice, formatPriceDelta } from "@/lib/money";
import {
  draftLimit,
  draftSubtotal,
  type EditDraft,
  editInput,
  editStaleReason,
  hasDraftChanges,
  initialDraft,
  isDraftEmpty,
  keptLineTotal,
  setKeptQuantity,
} from "@/lib/order-edit";
import { destinationLabel } from "@/lib/orders-board";
import { type MenuProduct, withPromos } from "@/lib/promo";
import { cn } from "@/lib/utils";

interface OrderEditDialogProps {
  restaurantId: string;
  /** Public menu of the restaurant: what can be added, with the same visibility, sold-out and discount rules. */
  restaurantSlug: string;
  /** The restaurant's `maxItemsPerOrder`. */
  maxItems: number;
  /** The order as it was when "Modificar" was tapped; null = closed. */
  order: OrderView | null;
  /** The board's current copy of that order (undefined once it left the board). */
  live: OrderView | undefined;
  onOpenChange(open: boolean): void;
  /** Saved: the api's answer (the board applies it and may reprint the ticket). */
  onSaved(updated: OrderView, previous: OrderView): void;
  /** Starts the dialog again on the board's newer copy (after someone else edited it). */
  onReload(order: OrderView): void;
  /** The board's lists may be stale (a conflict): fetch them again. */
  onRefresh(): void;
  /** The member lost the role meanwhile. */
  onForbidden(): void;
}

/**
 * "Modificar pedido" on the board: change quantities, remove lines or add products from the current menu
 * before the kitchen starts the order. Kept lines keep their price; added ones are priced by the api like a
 * new order, so the totals shown are an estimate. If the order changes on another device while the dialog is
 * open (started, charged, edited), saving is disabled and the dialog says why.
 */
export function OrderEditDialog(props: OrderEditDialogProps) {
  const { order, onOpenChange } = props;
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={order !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {/* Keyed by revision: loading the newer version starts from it with a clean draft. */}
        {order ? <EditForm key={`${order.id}-${order.revision}`} {...props} order={order} pending={pending} setPending={setPending} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  restaurantId,
  restaurantSlug,
  maxItems: restaurantMaxItems,
  order,
  live,
  onOpenChange,
  onSaved,
  onReload,
  onRefresh,
  onForbidden,
  pending,
  setPending,
}: OrderEditDialogProps & { order: OrderView; pending: boolean; setPending(pending: boolean): void }) {
  const [draft, setDraft] = useState<EditDraft>(() => initialDraft(order));
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<LineProblem | null>(null);
  // A 409 TOO_MANY_ITEMS brings the current cap (the owner may have lowered it after the page loaded).
  const [maxItems, setMaxItems] = useState(restaurantMaxItems);
  const reasonId = useId();
  const currency = order.currency;

  const stale = editStaleReason(order, live);
  const canReload = live !== undefined && live.revision !== order.revision && editStaleReason(live, live) === null;
  const limit = draftLimit(draft, maxItems);
  const subtotal = draftSubtotal(order, draft);
  const total = subtotal + order.deliveryFee;
  const changed = hasDraftChanges(order, draft);
  const empty = isDraftEmpty(draft);
  const cash = order.expectedPayment?.method === "cash" ? order.expectedPayment.cashAmount : null;
  const blocked = stale !== null || !changed || empty || limit.exceeded;
  // A refused line the staff already removed no longer blocks anything.
  const activeProblem = problem && draft.added.some((line) => line.productId === problem.productId) ? problem : null;

  function changeAdded(action: Parameters<typeof cartReducer>[1]) {
    setDraft((current) => ({ ...current, added: cartReducer(current.added, action) }));
    setError(null);
  }

  function addLine(line: CartLine) {
    if (line.quantity > limit.remaining) return;
    changeAdded({ type: "add", line });
    setPicking(false);
    toast.success(`${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.name} agregado`, { duration: 2000 });
  }

  async function save() {
    if (blocked || pending) return;
    setPending(true);
    setError(null);
    setProblem(null);
    try {
      const updated = await ordersApi.editItems(restaurantId, order.id, editInput(order.revision, draft, reason));
      toast.success(`Pedido #${order.ticketNumber} modificado`);
      onSaved(updated, order);
    } catch (failure) {
      if (hasCode(failure, "FORBIDDEN_ROLE")) {
        toast.error(errorMessage(failure));
        onForbidden();
        return;
      }
      if (hasCode(failure, "ORDER_NOT_FOUND")) {
        toast.info(errorMessage(failure));
        onRefresh();
        onOpenChange(false);
        return;
      }
      const productId = failure instanceof ApiError && LINE_ERRORS.includes(failure.code) ? failure.meta?.productId : undefined;
      if (productId && draft.added.some((line) => line.productId === productId)) {
        // Marked on the added line, with a button to remove it.
        setProblem({ productId, message: errorMessage(failure) });
      } else {
        setError(failure);
      }
      // Someone else moved the order: the board's copy shows what changed (and the dialog says it can no longer save).
      if (hasCode(failure, "ORDER_CHANGED", "ORDER_NOT_EDITABLE", "ORDER_ALREADY_PAID")) onRefresh();
      if (hasCode(failure, "TOO_MANY_ITEMS")) {
        const max = maxFromMeta(failure.meta);
        if (max !== null) setMaxItems(max);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="flex flex-col gap-4"
      data-testid="edit-order-dialog"
    >
      <DialogHeader>
        <DialogTitle>Modificar pedido #{order.ticketNumber}</DialogTitle>
        <DialogDescription>
          {destinationLabel(order)}. Puedes cambiarlo hasta que cocina lo empiece; el cliente verá el pedido actualizado.
        </DialogDescription>
      </DialogHeader>

      {stale ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg bg-warning px-3 py-2 text-sm font-medium text-warning-foreground"
          data-testid="edit-stale"
        >
          <p className="flex items-start gap-1.5">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {stale}
          </p>
          {canReload && live ? (
            <Button type="button" size="sm" variant="outline" className="self-start" disabled={pending} onClick={() => onReload(live)}>
              <RefreshCwIcon aria-hidden data-icon="inline-start" />
              Cargar la versión nueva
            </Button>
          ) : null}
        </div>
      ) : null}

      <ul className="flex flex-col divide-y" aria-label="Productos del pedido">
        {order.items.map((item, index) => (
          <KeptLine
            key={`${item.productId}-${index}`}
            item={item}
            quantity={draft.quantities[index] ?? 0}
            max={lineQuantityMax({ quantity: draft.quantities[index] ?? 0 }, limit)}
            currency={currency}
            disabled={pending}
            onQuantity={(quantity) => {
              setDraft((current) => setKeptQuantity(current, index, quantity));
              setError(null);
            }}
          />
        ))}
        {draft.added.map((line) => (
          <AddedLine
            key={line.key}
            line={line}
            max={lineQuantityMax(line, limit)}
            currency={currency}
            problem={activeProblem?.productId === line.productId ? activeProblem.message : null}
            disabled={pending}
            onQuantity={(quantity) => changeAdded({ type: "setQuantity", key: line.key, quantity })}
            onRemove={() => changeAdded({ type: "remove", key: line.key })}
          />
        ))}
      </ul>

      {picking ? (
        <MenuPicker
          slug={restaurantSlug}
          currency={currency}
          limit={limit}
          onAdd={addLine}
          onClose={() => setPicking(false)}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={pending || limit.remaining === 0}
          onClick={() => setPicking(true)}
          data-testid="edit-add-product"
        >
          <PlusIcon aria-hidden data-icon="inline-start" />
          Agregar producto
        </Button>
      )}

      {limit.remaining === 0 ? <ItemLimitNotice count={limit.count} max={limit.max} /> : null}
      {empty ? (
        <p role="status" className="flex items-start gap-1.5 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          El pedido no puede quedar vacío. Para anularlo, usa «Cancelar pedido» en la tarjeta.
        </p>
      ) : null}

      <dl className="flex flex-col gap-1 border-t pt-3 text-sm" aria-label="Total estimado">
        {order.channel === "delivery" ? (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatPrice(subtotal, currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Envío</dt>
              <dd className="tabular-nums">{order.deliveryFee > 0 ? formatPrice(order.deliveryFee, currency) : "Gratis"}</dd>
            </div>
          </>
        ) : null}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="font-semibold">Total estimado</dt>
          <dd className="text-lg font-bold tabular-nums" data-testid="edit-total">
            {formatPrice(total, currency)}
          </dd>
        </div>
        {changed ? (
          <div className="flex justify-between gap-3 text-muted-foreground">
            <dt>Antes</dt>
            <dd className="tabular-nums">{formatPrice(order.total, currency)}</dd>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">El total final lo calcula el sistema al guardar.</p>
      </dl>

      {cash !== null && total > cash ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm" data-testid="edit-cash-warning">
          El cliente dijo que paga con {formatPrice(cash, currency)}: no alcanza para el nuevo total. Habrá que preguntarle con
          cuánto paga.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor={reasonId}>Motivo (opcional)</Label>
        <Textarea
          id={reasonId}
          rows={2}
          maxLength={ORDER_LIMITS.editReasonMax}
          placeholder="Ej. el cliente cambió la bebida"
          value={reason}
          disabled={pending}
          aria-describedby={`${reasonId}-count`}
          onChange={(event) => setReason(event.target.value)}
        />
        <p id={`${reasonId}-count`} className="self-end text-xs text-muted-foreground tabular-nums">
          {reason.length}/{ORDER_LIMITS.editReasonMax}
        </p>
      </div>

      <FormError error={error} />

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Volver
        </Button>
        <SubmitButton pending={pending} disabled={blocked} data-testid="save-edit">
          Guardar cambios
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}

/** A line already in the order: its snapshot price, a stepper and "Quitar" (or "Deshacer" once removed). */
function KeptLine({
  item,
  quantity,
  max,
  currency,
  disabled,
  onQuantity,
}: {
  item: OrderItemView;
  quantity: number;
  max: number;
  currency: string;
  disabled: boolean;
  onQuantity(quantity: number): void;
}) {
  const removed = quantity === 0;
  const options = item.modifiers.map((m) => `${m.optionName}${m.priceDelta ? ` (${formatPriceDelta(m.priceDelta, currency)})` : ""}`);
  return (
    <li className="flex flex-col gap-2 py-3" data-testid="edit-line" data-removed={removed || undefined}>
      <div className="flex items-start justify-between gap-3">
        <LineText name={item.name} options={options} note={item.note} removed={removed} />
        <span className={cn("font-semibold tabular-nums", removed && "text-muted-foreground line-through")}>
          {formatPrice(removed ? item.lineTotal : keptLineTotal(item, quantity), currency)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        {removed ? (
          <>
            <span className="text-sm text-muted-foreground">Se quitará del pedido</span>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onQuantity(item.quantity)}>
              <RotateCcwIcon aria-hidden data-icon="inline-start" />
              Deshacer
            </Button>
          </>
        ) : (
          <>
            <span className="flex items-center gap-2">
              <QuantityStepper size="sm" value={quantity} max={Math.max(max, 1)} onChange={onQuantity} label={`Cantidad de ${item.name}`} />
              {quantity !== item.quantity ? <span className="text-xs text-muted-foreground">antes {item.quantity}</span> : null}
            </span>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onQuantity(0)} aria-label={`Quitar ${item.name}`}>
              <Trash2Icon aria-hidden data-icon="inline-start" />
              Quitar
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** A product added in this edit, priced with the menu's current price (the api's price is the final one). */
function AddedLine({
  line,
  max,
  currency,
  problem,
  disabled,
  onQuantity,
  onRemove,
}: {
  line: CartLine;
  max: number;
  currency: string;
  /** The api refused this product (sold out, hidden, options changed). */
  problem: string | null;
  disabled: boolean;
  onQuantity(quantity: number): void;
  onRemove(): void;
}) {
  return (
    <li
      className={cn("flex flex-col gap-2 py-3", problem && "-mx-2 rounded-lg bg-destructive/5 px-2 ring-1 ring-destructive/30")}
      data-testid="edit-added-line"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <Badge variant="secondary" className="mb-1 self-start">
            Nuevo
          </Badge>
          <LineText name={line.name} options={line.modifiers.map((m) => m.optionName)} note={line.note} removed={false} />
        </div>
        <span className="font-semibold tabular-nums">{formatPrice(lineTotal(line), currency)}</span>
      </div>
      {problem ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-destructive" role="alert">
          <CircleAlertIcon className="size-4 shrink-0" aria-hidden />
          {problem}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <QuantityStepper size="sm" value={line.quantity} max={max} onChange={onQuantity} label={`Cantidad de ${line.name}`} />
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onRemove} aria-label={`Quitar ${line.name}`}>
          <Trash2Icon aria-hidden data-icon="inline-start" />
          Quitar
        </Button>
      </div>
    </li>
  );
}

function LineText({ name, options, note, removed }: { name: string; options: string[]; note: string; removed: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col", removed && "text-muted-foreground")}>
      <span className={cn("font-semibold break-words", removed && "line-through")}>{name}</span>
      {options.length > 0 ? <span className="text-sm text-muted-foreground">{options.join(" · ")}</span> : null}
      {note ? <span className="text-sm text-muted-foreground italic">«{note}»</span> : null}
    </div>
  );
}

/**
 * The restaurant's current public menu (loaded when opened): visible products with their discounts; sold-out
 * ones are shown disabled. Choosing one opens the same product sheet customers use, for its options.
 */
function MenuPicker({
  slug,
  currency,
  limit,
  onAdd,
  onClose,
}: {
  slug: string;
  currency: string;
  limit: ReturnType<typeof draftLimit>;
  onAdd(line: CartLine): void;
  onClose(): void;
}) {
  const load = useCallback(() => publicOrdersApi.menu(slug), [slug]);
  const { data: menu, error, loading, reload } = useApiQuery<PublicMenu>(load);
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const titleId = useId();
  // Discounts by weekday and date, evaluated like the api does, so the estimate matches.
  const categories = useMemo(
    () => (menu ? withPromos(menu.categories, menu.restaurant.timezone).filter((category) => category.products.length > 0) : []),
    [menu],
  );

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg bg-muted/60 p-3" data-testid="edit-menu">
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="font-semibold">
          Agregar producto
        </h3>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Cerrar menú">
          <XIcon aria-hidden />
        </Button>
      </div>
      {error && !menu ? (
        <div className="flex flex-col items-start gap-3">
          <FormError error={error} />
          <Button type="button" variant="outline" onClick={reload}>
            Reintentar
          </Button>
        </div>
      ) : loading && !menu ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando menú">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : categories.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">El menú no tiene productos visibles.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {categories.map((category) => (
            <div key={category.id} className="flex flex-col gap-1">
              <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{category.name}</h4>
              <ul className="flex flex-col gap-1">
                {category.products.map((product: MenuProduct) => {
                  const soldOut = !product.available || blockedGroups(product).length > 0;
                  return (
                    <li key={product.id}>
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={() => setSelected(product)}
                        aria-haspopup="dialog"
                        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-left ring-1 ring-foreground/10 outline-none hover:bg-brand-soft focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card"
                        data-testid="edit-menu-product"
                      >
                        <span className="min-w-0 font-medium break-words">{product.name}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          {soldOut ? <Badge variant="destructive">Agotado</Badge> : null}
                          <span className="text-sm tabular-nums">{formatPrice(product.price, currency)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <OrderProductSheet
        product={selected}
        currency={currency}
        canOrder
        limit={limit}
        onClose={() => setSelected(null)}
        onAdd={(line) => {
          setSelected(null);
          onAdd(line);
        }}
      />
    </section>
  );
}
