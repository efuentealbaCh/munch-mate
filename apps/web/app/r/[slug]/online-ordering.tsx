"use client";

import type { PublicMenu, PublicProduct } from "@app/types";
import { normalizePhone } from "@app/utils";
import { ClockIcon, ReceiptTextIcon, ShoppingBagIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CartBar, type LineProblem } from "@/components/cart-sheet";
import { OrderProductSheet } from "@/components/order-product-sheet";
import { MenuSections } from "@/components/public-menu";
import { useOnVisible } from "@/hooks/use-realtime";
import { useStoredCart } from "@/hooks/use-stored-cart";
import { ApiError } from "@/lib/api";
import { localStore } from "@/lib/browser-storage";
import { type CartLine, cartCount, cartTotal, LINE_ERRORS, pickupCartScope, toOrderItems } from "@/lib/cart";
import { publicOrdersApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { loadMyOrders, rememberOrder, trackingHref } from "@/lib/order-tracking";
import type { PickupCheckoutValues } from "@/lib/validation";
import { PickupCartSheet } from "./pickup-cart-sheet";

const CLOSED_MESSAGE = "El local no está recibiendo pedidos ahora.";
const PICKUP_OFF_MESSAGE = "Este local ya no está recibiendo pedidos para retirar.";

/**
 * Public menu with pickup ordering (rendered when the owner enabled "Pedidos para retirar"): cart, checkout
 * with name and phone, and the tracking page afterwards. Customers order without an account.
 */
export function PickupOrdering({ initialMenu }: { initialMenu: PublicMenu }) {
  const router = useRouter();
  const [menu, setMenu] = useState(initialMenu);
  const slug = initialMenu.restaurant.slug;
  const { lines, dispatch, beginAttempt, completeOrder } = useStoredCart(pickupCartScope(slug));
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState<PickupCheckoutValues>({ customerName: "", customerPhone: "", customerEmail: "", note: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<LineProblem | null>(null);
  const [myOrdersCount, setMyOrdersCount] = useState(0);
  const { restaurant, categories } = menu;
  const currency = restaurant.currency;
  const canOrder = restaurant.acceptingOrders && restaurant.pickupEnabled;
  const closedMessage = restaurant.pickupEnabled ? CLOSED_MESSAGE : PICKUP_OFF_MESSAGE;

  useEffect(() => setMyOrdersCount(loadMyOrders(localStore()).length), []);

  // The menu carries the open/closed state too: one request refreshes both.
  const refreshMenu = useCallback(async () => {
    try {
      setMenu(await publicOrdersApi.menu(slug));
    } catch {
      // The stale menu stays; the api validates every order anyway.
    }
  }, [slug]);
  // Back from another app or tab: the restaurant may have opened or closed meanwhile.
  useOnVisible(() => void refreshMenu());

  function addLine(line: CartLine) {
    dispatch({ type: "add", line });
    setSelected(null);
    setProblem(null);
    toast.success(`${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.name} agregado`, { duration: 2000 });
  }

  async function submit(values: PickupCheckoutValues) {
    if (submitting || lines.length === 0) return;
    const body = {
      items: toOrderItems(lines),
      customerName: values.customerName,
      // Normalized here too, so "9 1234 5678" and "+56912345678" count as the same retry.
      customerPhone: normalizePhone(values.customerPhone) ?? values.customerPhone,
      ...(values.customerEmail ? { customerEmail: values.customerEmail } : {}),
      ...(values.note ? { note: values.note } : {}),
    };
    const clientOrderId = beginAttempt(body);
    setSubmitting(true);
    setError(null);
    setProblem(null);
    try {
      const created = await publicOrdersApi.createPickup(slug, { clientOrderId, ...body });
      rememberOrder(localStore(), {
        accessToken: created.accessToken,
        ticketNumber: created.order.ticketNumber,
        restaurantName: created.order.restaurant.name,
        createdAt: created.order.createdAt,
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
      if (hasCode(failure, "NOT_ACCEPTING_ORDERS")) setMenu((m) => ({ ...m, restaurant: { ...m.restaurant, acceptingOrders: false } }));
      if (hasCode(failure, "PICKUP_DISABLED")) setMenu((m) => ({ ...m, restaurant: { ...m.restaurant, pickupEnabled: false } }));
      setError(failure);
    }
  }

  const count = cartCount(lines);
  // A refused line the customer already removed (or changed) no longer blocks the submission.
  const activeProblem = problem && lines.some((line) => line.productId === problem.productId) ? problem : null;

  return (
    <>
      {canOrder ? (
        <div className="border-b bg-brand-soft" data-testid="pickup-banner">
          <p className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <ShoppingBagIcon className="size-4 shrink-0" aria-hidden />
              Pide aquí y retira en el local.
            </span>
            {myOrdersCount > 0 ? <MyOrdersLink /> : null}
          </p>
        </div>
      ) : (
        <div role="status" className="border-b bg-warning text-warning-foreground" data-testid="closed-banner">
          <p className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm font-medium">
            <span className="flex items-center gap-2">
              <ClockIcon className="size-4 shrink-0" aria-hidden />
              {closedMessage} Puedes ver el menú.
            </span>
            {myOrdersCount > 0 ? <MyOrdersLink /> : null}
          </p>
        </div>
      )}

      {categories.length === 0 ? (
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-2 px-4 py-16 text-center">
          <ClockIcon className="size-8 text-muted-foreground" aria-hidden />
          <h2 className="text-lg font-semibold">El menú se está preparando</h2>
          <p className="text-sm text-muted-foreground">Vuelve pronto para ver los productos de {restaurant.name}.</p>
        </main>
      ) : (
        <MenuSections categories={categories} currency={currency} onOpen={setSelected} className={count > 0 ? "pb-28" : undefined} />
      )}

      <CartBar count={count} total={cartTotal(lines)} currency={currency} onOpen={() => setCartOpen(true)} />

      <OrderProductSheet product={selected} currency={currency} canOrder={canOrder} onClose={() => setSelected(null)} onAdd={addLine} />
      <PickupCartSheet
        open={cartOpen}
        onOpenChange={(open) => {
          setCartOpen(open);
          if (open) void refreshMenu();
        }}
        lines={lines}
        currency={currency}
        restaurantName={restaurant.name}
        canOrder={canOrder}
        closedMessage={closedMessage}
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
    </>
  );
}

function MyOrdersLink() {
  return (
    <Link
      href="/pedido"
      className="inline-flex min-h-8 items-center gap-1 rounded-md font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ReceiptTextIcon className="size-4" aria-hidden />
      Mis pedidos
    </Link>
  );
}
