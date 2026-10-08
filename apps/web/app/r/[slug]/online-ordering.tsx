"use client";

import type { CreatedOrder, PaymentMethod, PublicDeliveryZone, PublicMenu, PublicProduct } from "@app/types";
import { normalizePhone } from "@app/utils";
import { BikeIcon, ClockIcon, ReceiptTextIcon, ShoppingBagIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CartBar, type LineProblem } from "@/components/cart-sheet";
import { OrderProductSheet } from "@/components/order-product-sheet";
import { MenuSections } from "@/components/public-menu";
import { useNow } from "@/hooks/use-now";
import { useOnVisible } from "@/hooks/use-realtime";
import { useRefreshAt } from "@/hooks/use-refresh-at";
import { useStoredCart } from "@/hooks/use-stored-cart";
import { ApiError } from "@/lib/api";
import { localStore } from "@/lib/browser-storage";
import { type CartLine, cartCount, cartTotal, LINE_ERRORS, pickupCartScope, toOrderItems } from "@/lib/cart";
import { loadDeliveryContact, type OnlineChannel, onlineChannels, resolveChannel, saveDeliveryContact } from "@/lib/delivery";
import { publicOrdersApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { parsePriceInput } from "@/lib/money";
import { closedByScheduleText, closedStateFromError } from "@/lib/opening-hours";
import { loadMyOrders, rememberOrder, trackingHref } from "@/lib/order-tracking";
import type { DeliveryCheckoutValues } from "@/lib/validation";
import { CheckoutSheet } from "./checkout-sheet";

const CLOSED_MESSAGE = "El local no está recibiendo pedidos ahora.";
const ONLINE_OFF_MESSAGE = "Este local ya no está recibiendo pedidos en línea.";

const EMPTY_CHECKOUT: DeliveryCheckoutValues = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  note: "",
  zoneId: "",
  address: "",
  unit: "",
  reference: "",
  paymentMethod: "",
  cashAmount: "",
};

/** Banner text for the channels on offer (the pickup-only text is the one phase 4 already used). */
function bannerText(channels: readonly OnlineChannel[]): string {
  if (channels.length > 1) return "Pide aquí para retirar en el local o con delivery.";
  return channels[0] === "delivery" ? "Pide aquí y te lo llevamos a domicilio." : "Pide aquí y retira en el local.";
}

/**
 * Public menu with online ordering (rendered when the owner enabled pickup and/or delivery): cart, the
 * channel choice, the matching checkout, and the tracking page afterwards. Customers order without an account.
 */
export function OnlineOrdering({ initialMenu }: { initialMenu: PublicMenu }) {
  const router = useRouter();
  const [menu, setMenu] = useState(initialMenu);
  const slug = initialMenu.restaurant.slug;
  const { lines, dispatch, beginAttempt, completeOrder } = useStoredCart(pickupCartScope(slug));
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkout, setCheckout] = useState<DeliveryCheckoutValues>(EMPTY_CHECKOUT);
  const [chosenChannel, setChosenChannel] = useState<OnlineChannel | null>(null);
  const [zones, setZones] = useState<PublicDeliveryZone[] | null>(null);
  const [zonesError, setZonesError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<LineProblem | null>(null);
  const [myOrdersCount, setMyOrdersCount] = useState(0);
  const { restaurant, categories } = menu;
  const currency = restaurant.currency;
  const channels = onlineChannels(restaurant);
  const channel = resolveChannel(chosenChannel, channels) ?? "pickup";
  const now = useNow(30_000);
  // The switch is on but the opening hours keep the restaurant closed: say when it opens.
  const closedBySchedule = channels.length > 0 && restaurant.acceptingOrders && !restaurant.openState.openNow;
  const canOrder = restaurant.acceptingOrders && restaurant.openState.openNow && channels.length > 0;
  const closedMessage =
    channels.length === 0
      ? ONLINE_OFF_MESSAGE
      : closedBySchedule
        ? `${closedByScheduleText(restaurant.openState, now ? new Date(now) : null)}.`
        : CLOSED_MESSAGE;

  useEffect(() => {
    setMyOrdersCount(loadMyOrders(localStore()).length);
    // Convenience only: what this phone used last time for a delivery.
    const saved = loadDeliveryContact(localStore());
    if (saved) setCheckout((current) => ({ ...current, ...saved }));
  }, []);

  // The menu carries the open/closed state and the channel switches too: one request refreshes all.
  const refreshMenu = useCallback(async () => {
    try {
      setMenu(await publicOrdersApi.menu(slug));
    } catch {
      // The stale menu stays; the api validates every order anyway.
    }
  }, [slug]);

  const refreshZones = useCallback(async () => {
    setZonesError(null);
    try {
      setZones(await publicOrdersApi.deliveryZones(slug));
    } catch (failure) {
      // 404: delivery was turned off meanwhile (or the restaurant is gone).
      if (hasCode(failure, "DELIVERY_DISABLED") || hasCode(failure, "MENU_NOT_FOUND")) {
        setMenu((m) => ({ ...m, restaurant: { ...m.restaurant, deliveryEnabled: false } }));
        return;
      }
      setZonesError(failure);
    }
  }, [slug]);

  const deliveryEnabled = restaurant.deliveryEnabled;
  useEffect(() => {
    if (deliveryEnabled) void refreshZones();
  }, [deliveryEnabled, refreshZones]);

  // Back from another app or tab: the restaurant may have opened or closed meanwhile.
  useOnVisible(() => void refreshMenu());
  // Closed by the schedule: refresh when it opens, so the cart unlocks without reloading the page.
  useRefreshAt(closedBySchedule ? restaurant.openState.nextOpeningAt : null, () => void refreshMenu());

  function addLine(line: CartLine) {
    dispatch({ type: "add", line });
    setSelected(null);
    setProblem(null);
    toast.success(`${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.name} agregado`, { duration: 2000 });
  }

  /** Common part of both submissions: idempotent id, errors, "mis pedidos" and the tracking page. */
  async function place<B extends Parameters<typeof beginAttempt>[0]>(body: B, create: (clientOrderId: string) => Promise<CreatedOrder>) {
    if (submitting || lines.length === 0) return false;
    const clientOrderId = beginAttempt(body);
    setSubmitting(true);
    setError(null);
    setProblem(null);
    try {
      const created = await create(clientOrderId);
      rememberOrder(localStore(), {
        accessToken: created.accessToken,
        ticketNumber: created.order.ticketNumber,
        restaurantName: created.order.restaurant.name,
        createdAt: created.order.createdAt,
      });
      completeOrder();
      router.push(trackingHref(created.accessToken));
      return true;
    } catch (failure) {
      setSubmitting(false);
      if (failure instanceof ApiError && LINE_ERRORS.includes(failure.code) && failure.meta?.productId) {
        setProblem({ productId: failure.meta.productId, message: failure.message });
        void refreshMenu();
        return false;
      }
      if (hasCode(failure, "OUTSIDE_OPENING_HOURS")) {
        // The schedule closed while the customer was ordering: show the banner now, then confirm with the api.
        const openState = closedStateFromError(failure.meta);
        setMenu((m) => ({ ...m, restaurant: { ...m.restaurant, openState } }));
        void refreshMenu();
      }
      if (hasCode(failure, "NOT_ACCEPTING_ORDERS")) setMenu((m) => ({ ...m, restaurant: { ...m.restaurant, acceptingOrders: false } }));
      if (hasCode(failure, "PICKUP_DISABLED")) setMenu((m) => ({ ...m, restaurant: { ...m.restaurant, pickupEnabled: false } }));
      if (hasCode(failure, "DELIVERY_DISABLED")) setMenu((m) => ({ ...m, restaurant: { ...m.restaurant, deliveryEnabled: false } }));
      // The zone was deactivated or its minimum changed: show the current list.
      if (hasCode(failure, "ZONE_NOT_AVAILABLE", "BELOW_MINIMUM_ORDER")) void refreshZones();
      setError(failure);
      return false;
    }
  }

  function contactBody(values: DeliveryCheckoutValues) {
    return {
      items: toOrderItems(lines),
      customerName: values.customerName,
      // Normalized here too, so "9 1234 5678" and "+56912345678" count as the same retry.
      customerPhone: normalizePhone(values.customerPhone) ?? values.customerPhone,
      ...(values.customerEmail ? { customerEmail: values.customerEmail } : {}),
      ...(values.note ? { note: values.note } : {}),
    };
  }

  function submitPickup(values: DeliveryCheckoutValues) {
    const body = contactBody(values);
    void place(body, (clientOrderId) => publicOrdersApi.createPickup(slug, { clientOrderId, ...body }));
  }

  function submitDelivery(values: DeliveryCheckoutValues) {
    const method = values.paymentMethod as PaymentMethod;
    const cashAmount = method === "cash" ? parsePriceInput(values.cashAmount) : null;
    const body = {
      ...contactBody(values),
      delivery: {
        zoneId: values.zoneId,
        address: values.address,
        ...(values.unit ? { unit: values.unit } : {}),
        ...(values.reference ? { reference: values.reference } : {}),
      },
      payment: { method, ...(cashAmount !== null ? { cashAmount } : {}) },
    };
    void place(body, (clientOrderId) => publicOrdersApi.createDelivery(slug, { clientOrderId, ...body })).then((ok) => {
      if (!ok) return;
      saveDeliveryContact(localStore(), {
        customerName: values.customerName,
        customerPhone: values.customerPhone,
        customerEmail: values.customerEmail,
        zoneId: values.zoneId,
        address: values.address,
        unit: values.unit,
        reference: values.reference,
      });
    });
  }

  const count = cartCount(lines);
  // A refused line the customer already removed (or changed) no longer blocks the submission.
  const activeProblem = problem && lines.some((line) => line.productId === problem.productId) ? problem : null;
  const BannerIcon = channels.length === 1 && channels[0] === "delivery" ? BikeIcon : ShoppingBagIcon;

  return (
    <>
      {canOrder ? (
        <div className="border-b bg-brand-soft" data-testid="pickup-banner">
          <p className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <BannerIcon className="size-4 shrink-0" aria-hidden />
              {bannerText(channels)}
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
      <CheckoutSheet
        open={cartOpen}
        onOpenChange={(open) => {
          setCartOpen(open);
          if (open) {
            void refreshMenu();
            if (restaurant.deliveryEnabled) void refreshZones();
          }
        }}
        restaurantName={restaurant.name}
        channels={channels}
        channel={channel}
        onChannelChange={(next) => {
          setChosenChannel(next);
          setError(null);
        }}
        zones={{ zones, error: zonesError, retry: () => void refreshZones() }}
        lines={lines}
        currency={currency}
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
        onSubmitPickup={submitPickup}
        onSubmitDelivery={submitDelivery}
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
