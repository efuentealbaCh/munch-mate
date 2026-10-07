"use client";

import { MENU_LIMITS } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { ImageField } from "@/components/image-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { restaurantsApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { type RestaurantProfileValues, restaurantProfileSchema } from "@/lib/validation";
import { useRestaurant } from "./restaurant-context";

const MIN_SIDE = MENU_LIMITS.imageMinSide;

/** Owner form for what customers see at the top of the public menu: logo, description and phone. */
export function ProfileForm() {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const form = useForm<RestaurantProfileValues>({
    resolver: zodResolver(restaurantProfileSchema),
    defaultValues: { description: restaurant.description, phone: restaurant.phone },
  });
  const { errors } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(values: RestaurantProfileValues) {
    setError(null);
    const changes = {
      ...(values.description !== restaurant.description ? { description: values.description } : {}),
      ...(values.phone !== restaurant.phone ? { phone: values.phone } : {}),
    };
    if (Object.keys(changes).length === 0) {
      toast.info("No hay cambios que guardar");
      return;
    }
    setSaving(true);
    try {
      const updated = await restaurantsApi.update(restaurant.id, changes);
      toast.success("Perfil actualizado");
      setRestaurant(updated);
    } catch (failure) {
      setError(failure);
      if (hasCode(failure, "FORBIDDEN_ROLE")) reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <ImageField
        label="Logo"
        shape="logo"
        imageUrl={restaurant.logo?.md ?? null}
        description={`JPG, PNG, WebP o AVIF de hasta 8 MB y al menos ${MIN_SIDE}×${MIN_SIDE} px. Se ve mejor si es cuadrado.`}
        onUpload={async (file) => {
          setRestaurant(await restaurantsApi.setLogo(restaurant.id, file));
          toast.success("Logo actualizado");
        }}
        onRemove={async () => {
          setRestaurant(await restaurantsApi.removeLogo(restaurant.id));
          toast.success("Logo eliminado");
        }}
      />
      <Separator />
      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" aria-label="Perfil público">
        <FormField
          id="profile-description"
          label="Descripción"
          error={errors.description?.message}
          description="Aparece bajo el nombre en tu menú. Ej.: Sándwiches y café de especialidad en Ñuñoa."
        >
          {(control) => <Textarea {...control} rows={3} maxLength={300} {...form.register("description")} />}
        </FormField>
        <FormField
          id="profile-phone"
          label="Teléfono"
          error={errors.phone?.message}
          description="Opcional. Tus clientes podrán llamarte desde el menú."
        >
          {(control) => (
            <Input {...control} type="tel" inputMode="tel" autoComplete="tel" placeholder="+56 9 1234 5678" {...form.register("phone")} />
          )}
        </FormField>
        <FormError error={error} />
        <SubmitButton pending={saving} className="self-start">
          Guardar perfil
        </SubmitButton>
      </form>
    </div>
  );
}
