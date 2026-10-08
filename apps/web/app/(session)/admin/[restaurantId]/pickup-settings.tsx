"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { usePublicHost } from "@/hooks/use-slug-availability";
import { restaurantsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { useRestaurant } from "./restaurant-context";

/**
 * Owner switch for "Pedidos para retirar": when on, the public menu /r/{slug} gets a cart and a pickup
 * checkout. Off by default. Saved at once (optimistic, reverted if the api refuses).
 */
export function PickupSettings() {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const host = usePublicHost();
  const [saving, setSaving] = useState(false);
  const switchId = useId();
  const descriptionId = useId();

  async function toggle(pickupEnabled: boolean) {
    const previous = restaurant;
    setSaving(true);
    setRestaurant({ ...restaurant, pickupEnabled });
    try {
      setRestaurant(await restaurantsApi.update(restaurant.id, { pickupEnabled }));
      toast.success(pickupEnabled ? "Ahora recibes pedidos para retirar" : "Desactivaste los pedidos para retirar");
    } catch (failure) {
      setRestaurant(previous);
      toast.error(errorMessage(failure));
      // Lost the owner role meanwhile: reload so the page hides owner controls.
      if (hasCode(failure, "FORBIDDEN_ROLE")) reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label htmlFor={switchId} className="flex cursor-pointer items-start gap-4">
        <Switch
          id={switchId}
          size="lg"
          className="mt-0.5"
          checked={restaurant.pickupEnabled}
          disabled={saving || restaurant.status === "suspended"}
          aria-describedby={descriptionId}
          onCheckedChange={(checked) => void toggle(checked)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">Pedidos para retirar</span>
          <span id={descriptionId} className="text-sm text-muted-foreground">
            Tus clientes piden desde el menú público con su nombre y teléfono, y lo retiran en el local. Tú aceptas cada
            pedido y les dices a qué hora estará listo. Pagan al retirar.
          </span>
        </span>
      </label>
      {restaurant.pickupEnabled && !restaurant.acceptingOrders ? (
        <p className="rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground" role="status">
          El local está cerrado: abre en <strong>Pedidos</strong> («Recibiendo pedidos») para que puedan pedir.
        </p>
      ) : null}
      <p className="text-sm">
        <span className="text-muted-foreground">Los clientes piden en </span>
        <a
          href={`/r/${restaurant.slug}`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-start gap-1 rounded-sm font-mono break-all text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {host}/r/{restaurant.slug}
          <ExternalLinkIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="sr-only">(se abre en una pestaña nueva)</span>
        </a>
      </p>
    </div>
  );
}
