"use client";

import type { OpenState, PublicMenu, PublicProduct, TableContext } from "@app/types";
import { ClockIcon, ReceiptTextIcon, StoreIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CartBar, type LineProblem } from "@/components/cart-sheet";
import { OrderProductSheet } from "@/components/order-product-sheet";
import { MenuSections } from "@/components/public-menu";
import { RestaurantLogo } from "@/components/restaurant-logo";
import { Badge } from "@/components/ui/badge";
import { useNow } from "@/hooks/use-now";
import { useOnVisible } from "@/hooks/use-realtime";
import { useRefreshAt } from "@/hooks/use-refresh-at";
import { useStoredCart } from "@/hooks/use-stored-cart";
import { ApiError } from "@/lib/api";
import { localStore } from "@/lib/browser-storage";
import {
  type CartLine,
  cartCount,
  cartTotal,
  itemLimit,
  itemLimitMessage,
  LINE_ERRORS,
  maxFromMeta,
  toOrderItems,
} from "@/lib/cart";
import { publicOrdersApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { closedByScheduleText, closedStateFromError } from "@/lib/opening-hours";
import { loadMyOrders, rememberOrder, trackingHref } from "@/lib/order-tracking";
import type { CheckoutValues } from "@/lib/validation";
import { TableCartSheet } from "./cart-sheet";

interface TableOrderingProps {
  tableToken: string;
  table: TableContext;
  initialMenu: PublicMenu;
}

/** Menu + cart + checkout for one table. Customers order without an account; the table QR identifies them. */
export function TableOrdering({ tableToken, table, initialMenu }: TableOrderingProps) {
  const router = useRouter();
  const [menu, setMenu] = useState(initialMenu);
  const [accepting, setAccepting] = useState(table.acceptingOrders);
  const [openState, setOpenState] = useState<OpenState>(table.openState);
  const [tableGone, setTableGone] = useState(false);
  // Units per order (owner setting): refreshed with the table and the menu, and from a 409 TOO_MANY_ITEMS.
  const [maxItems, setMaxItems] = useState(table.maxItemsPerOrder);
  const { lines, dispatch, beginAttempt, completeOrder } = useStoredCart(tableToken);
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutValues>({ customerName: "", note: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<LineProblem | null>(null);
  const [myOrdersCount, setMyOrdersCount] = useState(0);
  const currency = menu.restaurant.currency;
  const now = useNow(30_000);
  const closedBySchedule = accepting && !openState.openNow && !tableGone;
  const canOrder = accepting && openState.openNow && !tableGone;

  useEffect(() => setMyOrdersCount(loadMyOrders(localStore()).length), []);

  // Back from another app or tab: the restaurant may have opened or closed meanwhile.
  const refreshTable = useCallback(async () => {
    try {
      const fresh = await publicOrdersApi.table(tableToken);
      setAccepting(fresh.acceptingOrders);
      setOpenState(fresh.openState);
      setMaxItems(fresh.maxItemsPerOrder);
      setTableGone(false);
    } catch (failure) {
      if (hasCode(failure, "TABLE_NOT_FOUND")) setTableGone(true);
      // Anything else (offline): keep the last known state; the order request will tell the truth.
    }
  }, [tableToken]);
  useOnVisible(() => void refreshTable());
  // Closed by the schedule: refresh when it opens, so the cart unlocks without reloading the page.
  useRefreshAt(closedBySchedule ? openState.nextOpeningAt : null, () => void refreshTable());

  const refreshMenu = useCallback(async () => {
    try {
      const fresh = await publicOrdersApi.menu(menu.restaurant.slug);
      setMenu(fresh);
      setMaxItems(fresh.restaurant.maxItemsPerOrder);
    } catch {
      // The stale menu stays; the api keeps validating every order anyway.
    }
  }, [menu.restaurant.slug]);

  function addLine(line: CartLine) {
    // The product sheet already caps the quantity; this covers a cap lowered while the sheet was open.
    const limit = itemLimit(lines, maxItems);
    if (line.quantity > limit.remaining) {
      toast.error(itemLimitMessage(limit));
      return;
    }
    dispatch({ type: "add", line });
    setSelected(null);
    setProblem(null);
    toast.success(`${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.name} agregado`, { duration: 2000 });
  }

  async function submit(values: CheckoutValues) {
    if (submitting || lines.length === 0 || cartCount(lines) > maxItems) return;
    const body = {
      items: toOrderItems(lines),
      ...(values.customerName ? { customerName: values.customerName } : {}),
      ...(values.note ? { note: values.note } : {}),
    };
    // Same content as a failed attempt → same id, so the api returns that order instead of a duplicate.
    const clientOrderId = beginAttempt(body);
    setSubmitting(true);
    setError(null);
    setProblem(null);
    try {
      const created = await publicOrdersApi.create(tableToken, { clientOrderId, ...body });
      rememberOrder(localStore(), {
        accessToken: created.accessToken,
        ticketNumber: created.order.ticketNumber,
        restaurantName: created.order.restaurant.name,
        createdAt: created.order.createdAt,
        tableToken,
      });
      completeOrder();
      router.push(trackingHref(created.accessToken));
    } catch (failure) {
      setSubmitting(false);
      if (failure instanceof ApiError && LINE_ERRORS.includes(failure.code) && failure.meta?.productId) {
        setProblem({ productId: failure.meta.productId, message: failure.message });
        void refreshMenu();
        return;
      }
      if (hasCode(failure, "NOT_ACCEPTING_ORDERS")) setAccepting(false);
      if (hasCode(failure, "OUTSIDE_OPENING_HOURS")) {
        setOpenState(closedStateFromError(failure.meta));
        void refreshTable();
      }
      if (hasCode(failure, "TABLE_NOT_FOUND")) setTableGone(true);
      // The owner lowered the cap after the menu loaded: apply it so the cart shows what to remove.
      if (hasCode(failure, "TOO_MANY_ITEMS")) {
        const max = maxFromMeta(failure.meta);
        if (max !== null) setMaxItems(max);
        else void refreshTable();
      }
      setError(failure);
    }
  }

  const count = cartCount(lines);
  // A refused line the customer already removed (or changed) no longer blocks the submission.
  const activeProblem = problem && lines.some((line) => line.productId === problem.productId) ? problem : null;
  const { restaurant, categories } = menu;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <RestaurantLogo logo={restaurant.logo} size="md" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-xl font-bold tracking-tight break-words">{restaurant.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="h-6 px-2.5 text-sm" data-testid="table-label">
                {table.tableLabel}
              </Badge>
              {myOrdersCount > 0 ? (
                <Link
                  href="/pedido"
                  className="inline-flex min-h-8 items-center gap-1 rounded-md text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <ReceiptTextIcon className="size-4" aria-hidden />
                  Mis pedidos
                </Link>
              ) : null}
            </div>
          </div>
        </div>
        {!canOrder ? (
          <div role="status" className="border-t bg-warning text-warning-foreground" data-testid="closed-banner">
            <p className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3 text-sm font-medium">
              {tableGone ? <StoreIcon className="size-4 shrink-0" aria-hidden /> : <ClockIcon className="size-4 shrink-0" aria-hidden />}
              {tableGone
                ? "Este código QR ya no está activo. Pide ayuda al personal."
                : closedBySchedule
                  ? `${closedByScheduleText(openState, now ? new Date(now) : null)}. Puedes ver el menú.`
                  : "El local no está recibiendo pedidos ahora. Puedes ver el menú."}
            </p>
          </div>
        ) : null}
      </header>

      {categories.length === 0 ? (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-2 px-4 py-16 text-center">
          <ClockIcon className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">El menú se está preparando</h2>
          <p className="text-sm text-muted-foreground">Pide ayuda al personal para hacer tu pedido.</p>
        </main>
      ) : (
        <MenuSections categories={categories} currency={currency} onOpen={setSelected} className={count > 0 ? "pb-28" : undefined} />
      )}

      <CartBar count={count} total={cartTotal(lines)} currency={currency} onOpen={() => setCartOpen(true)} />

      <footer className="border-t px-4 py-6 text-center text-xs text-muted-foreground">
        Pedidos con <span className="font-semibold text-foreground">Munch Mate</span>
      </footer>

      <OrderProductSheet
        product={selected}
        currency={currency}
        canOrder={canOrder}
        limit={itemLimit(lines, maxItems)}
        onClose={() => setSelected(null)}
        onAdd={addLine}
      />
      <TableCartSheet
        open={cartOpen}
        onOpenChange={(open) => {
          setCartOpen(open);
          if (open) void refreshTable();
        }}
        lines={lines}
        currency={currency}
        tableLabel={table.tableLabel}
        maxItems={maxItems}
        canOrder={canOrder}
        {...(closedBySchedule ? { closedMessage: `${closedByScheduleText(openState, now ? new Date(now) : null)}.` } : {})}
        submitting={submitting}
        error={error}
        problem={activeProblem}
        checkout={checkout}
        onCheckoutChange={setCheckout}
        onQuantity={(key, quantity) => dispatch({ type: "setQuantity", key, quantity })}
        onRemove={(key) => dispatch({ type: "remove", key })}
        onRemoveProduct={(productId) => {
          dispatch({ type: "removeProduct", productId });
          setProblem(null);
          toast.info("Quitamos el producto de tu pedido. Revisa el menú actualizado.");
        }}
        onSubmit={(values) => void submit(values)}
      />
    </div>
  );
}

