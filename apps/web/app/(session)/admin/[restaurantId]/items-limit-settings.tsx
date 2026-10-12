"use client";

import { ORDER_LIMITS } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { restaurantsApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { type ItemsLimitValues, itemsLimitSchema } from "@/lib/validation";
import { useRestaurant } from "./restaurant-context";

const DESCRIPTION = `Suma de cantidades en un pedido (entre ${ORDER_LIMITS.itemsPerOrderMin} y ${ORDER_LIMITS.itemsPerOrderMax}). Evita pedidos absurdos o de broma; el carrito no deja pasar de este número.`;

/** Read-only row for the rest of the team (goes inside the summary's `<dl>`). */
export function ItemsLimitView() {
  const { restaurant } = useRestaurant();
  return (
    <div>
      <dt className="text-muted-foreground">Máximo de productos por pedido</dt>
      <dd data-testid="items-limit">{restaurant.maxItemsPerOrder} (lo cambia el dueño)</dd>
    </div>
  );
}

/**
 * Owner form for "Máximo de productos por pedido" (`maxItemsPerOrder`). Applies to every channel (table QR,
 * pickup and delivery); the api enforces it too (409 TOO_MANY_ITEMS).
 */
export function ItemsLimitSettings() {
  const { restaurant } = useRestaurant();
  // Remount after each save so the form starts from the stored value.
  return <ItemsLimitForm key={restaurant.maxItemsPerOrder} />;
}

function ItemsLimitForm() {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const form = useForm<ItemsLimitValues>({
    resolver: zodResolver(itemsLimitSchema),
    defaultValues: { maxItemsPerOrder: restaurant.maxItemsPerOrder },
  });
  const { errors } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const suspended = restaurant.status === "suspended";

  async function onSubmit(values: ItemsLimitValues) {
    setError(null);
    if (values.maxItemsPerOrder === restaurant.maxItemsPerOrder) {
      toast.info("No hay cambios que guardar");
      return;
    }
    setSaving(true);
    try {
      setRestaurant(await restaurantsApi.update(restaurant.id, { maxItemsPerOrder: values.maxItemsPerOrder }));
      toast.success("Límite de productos actualizado");
    } catch (failure) {
      setError(failure);
      // Lost the owner role meanwhile: reload so the page hides owner controls.
      if (hasCode(failure, "FORBIDDEN_ROLE")) reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3" aria-label="Máximo de productos por pedido">
      <FormField id="items-limit" label="Máximo de productos por pedido" error={errors.maxItemsPerOrder?.message} description={DESCRIPTION}>
        {(control) => (
          <Input
            {...control}
            type="number"
            inputMode="numeric"
            min={ORDER_LIMITS.itemsPerOrderMin}
            max={ORDER_LIMITS.itemsPerOrderMax}
            step={1}
            disabled={suspended}
            className="max-w-32"
            {...form.register("maxItemsPerOrder", { valueAsNumber: true })}
          />
        )}
      </FormField>
      <FormError error={error} />
      <SubmitButton pending={saving} disabled={suspended} variant="outline" className="self-start">
        Guardar límite
      </SubmitButton>
    </form>
  );
}
