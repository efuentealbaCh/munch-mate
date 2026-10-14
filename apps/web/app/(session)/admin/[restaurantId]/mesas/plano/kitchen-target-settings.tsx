"use client";

import { KITCHEN_TARGET_LIMITS } from "@app/types";
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
import { type KitchenTargetValues, kitchenTargetSchema } from "@/lib/validation";
import { useRestaurant } from "../../restaurant-context";

const DESCRIPTION = `Cuánto debería tardar un pedido desde que se acepta hasta que está listo (entre ${KITCHEN_TARGET_LIMITS.minutesMin} y ${KITCHEN_TARGET_LIMITS.minutesMax} min). La vista En vivo compara el promedio del día con esta meta.`;

/** Owner form for `kitchenTargetMinutes`, the kitchen goal of the live floor view (phase 9). */
export function KitchenTargetSettings() {
  const { restaurant } = useRestaurant();
  // Remount after each save so the form starts from the stored value.
  return <KitchenTargetForm key={restaurant.kitchenTargetMinutes} />;
}

function KitchenTargetForm() {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const form = useForm<KitchenTargetValues>({
    resolver: zodResolver(kitchenTargetSchema),
    defaultValues: { kitchenTargetMinutes: restaurant.kitchenTargetMinutes },
  });
  const { errors } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const suspended = restaurant.status === "suspended";

  async function onSubmit(values: KitchenTargetValues) {
    setError(null);
    if (values.kitchenTargetMinutes === restaurant.kitchenTargetMinutes) {
      toast.info("No hay cambios que guardar");
      return;
    }
    setSaving(true);
    try {
      setRestaurant(await restaurantsApi.update(restaurant.id, { kitchenTargetMinutes: values.kitchenTargetMinutes }));
      toast.success("Tiempo meta de cocina actualizado");
    } catch (failure) {
      setError(failure);
      // Lost the owner role meanwhile: reload so the page hides owner controls.
      if (hasCode(failure, "FORBIDDEN_ROLE")) reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3" aria-label="Tiempo meta de cocina">
      <FormField id="kitchen-target" label="Tiempo meta de cocina (min)" error={errors.kitchenTargetMinutes?.message} description={DESCRIPTION}>
        {(control) => (
          <Input
            {...control}
            type="number"
            inputMode="numeric"
            min={KITCHEN_TARGET_LIMITS.minutesMin}
            max={KITCHEN_TARGET_LIMITS.minutesMax}
            step={1}
            disabled={suspended}
            className="max-w-32"
            {...form.register("kitchenTargetMinutes", { valueAsNumber: true })}
          />
        )}
      </FormField>
      <FormError error={error} />
      <SubmitButton pending={saving} disabled={suspended} variant="outline" className="self-start">
        Guardar meta
      </SubmitButton>
    </form>
  );
}
