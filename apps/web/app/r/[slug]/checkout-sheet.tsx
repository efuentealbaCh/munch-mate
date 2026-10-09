"use client";

import { BikeIcon, ShoppingBagIcon } from "lucide-react";
import { CartSheet } from "@/components/cart-sheet";
import { Button } from "@/components/ui/button";
import { ONLINE_CHANNEL_LABELS, type OnlineChannel } from "@/lib/delivery";
import type { DeliveryCheckoutValues } from "@/lib/validation";
import { DeliveryCheckout, type DeliveryPinProps, type ZonesState } from "./delivery-checkout";
import { type CheckoutFormProps, PickupCheckout } from "./pickup-checkout";

const CHANNEL_ICONS: Record<OnlineChannel, typeof BikeIcon> = { pickup: ShoppingBagIcon, delivery: BikeIcon };

interface CheckoutSheetProps extends CheckoutFormProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  restaurantName: string;
  /** Channels the restaurant offers (one → no selector). */
  channels: readonly OnlineChannel[];
  channel: OnlineChannel;
  onChannelChange(channel: OnlineChannel): void;
  zones: ZonesState;
  /** The delivery pin on the map (phase 7). */
  pin: DeliveryPinProps;
  /** Contact and address typed so far: shared by both forms, kept while the sheet is closed. */
  checkout: DeliveryCheckoutValues;
  onCheckoutChange(values: DeliveryCheckoutValues): void;
  onSubmitPickup(values: DeliveryCheckoutValues): void;
  onSubmitDelivery(values: DeliveryCheckoutValues): void;
}

/** "Tu pedido": the channel choice (when both are on) and the matching checkout form. */
export function CheckoutSheet({
  open,
  onOpenChange,
  restaurantName,
  channels,
  channel,
  onChannelChange,
  zones,
  pin,
  checkout,
  onCheckoutChange,
  onSubmitPickup,
  onSubmitDelivery,
  ...form
}: CheckoutSheetProps) {
  const description =
    channel === "delivery"
      ? `Delivery de ${restaurantName} · revisa antes de enviar.`
      : `Para retirar en ${restaurantName} · revisa antes de enviar.`;
  return (
    <CartSheet open={open} onOpenChange={onOpenChange} submitting={form.submitting} description={description} empty={form.lines.length === 0}>
      {channels.length > 1 ? (
        <div role="radiogroup" aria-label="¿Cómo quieres recibirlo?" className="grid grid-cols-2 gap-2 px-4 pt-1 pb-2">
          {channels.map((option) => {
            const Icon = CHANNEL_ICONS[option];
            const checked = option === channel;
            return (
              <Button
                key={option}
                type="button"
                role="radio"
                aria-checked={checked}
                size="lg"
                variant={checked ? "default" : "outline"}
                disabled={form.submitting}
                onClick={() => onChannelChange(option)}
              >
                <Icon aria-hidden data-icon="inline-start" />
                {ONLINE_CHANNEL_LABELS[option]}
              </Button>
            );
          })}
        </div>
      ) : null}
      {channel === "delivery" ? (
        <DeliveryCheckout {...form} zones={zones} pin={pin} checkout={checkout} onCheckoutChange={onCheckoutChange} onSubmit={onSubmitDelivery} />
      ) : (
        <PickupCheckout
          {...form}
          checkout={checkout}
          onCheckoutChange={(values) => onCheckoutChange({ ...checkout, ...values })}
          onSubmit={(values) => onSubmitPickup({ ...checkout, ...values })}
        />
      )}
    </CartSheet>
  );
}
