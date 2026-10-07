"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SlugField } from "@/components/slug-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { useRestaurantForm } from "@/hooks/use-restaurant-form";
import { restaurantsApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { slugStatusAllowsSubmit } from "@/lib/slug-field";
import type { RestaurantValues } from "@/lib/validation";
import { useRestaurant } from "./restaurant-context";

/** Owner form to rename the restaurant or change its slug (with a warning, since links break). */
export function SettingsForm() {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const { form, slugStatus, markTaken, nameField, slugField, applySuggestion } = useRestaurantForm({
    name: restaurant.name,
    slug: restaurant.slug,
  });
  const { errors } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<RestaurantValues | null>(null);

  function onSubmit(values: RestaurantValues) {
    setError(null);
    if (!slugStatusAllowsSubmit(slugStatus)) {
      form.setFocus("slug");
      return;
    }
    if (values.name === restaurant.name && values.slug === restaurant.slug) {
      toast.info("No hay cambios que guardar");
      return;
    }
    if (values.slug !== restaurant.slug) setConfirming(values);
    else void save(values);
  }

  async function save(values: RestaurantValues) {
    setSaving(true);
    try {
      const changes = {
        ...(values.name !== restaurant.name ? { name: values.name } : {}),
        ...(values.slug !== restaurant.slug ? { slug: values.slug } : {}),
      };
      const updated = await restaurantsApi.update(restaurant.id, changes);
      toast.success("Cambios guardados");
      setConfirming(null);
      setSaving(false);
      setRestaurant(updated);
    } catch (failure) {
      setConfirming(null);
      setSaving(false);
      if (hasCode(failure, "SLUG_TAKEN")) {
        markTaken(values.slug, failure.meta?.suggestion);
        form.setFocus("slug");
      } else if (hasCode(failure, "INVALID_SLUG")) {
        form.setError("slug", { message: failure.message }, { shouldFocus: true });
      } else {
        setError(failure);
        // Lost the owner role meanwhile: reload so the page hides owner controls.
        if (hasCode(failure, "FORBIDDEN_ROLE")) reload();
      }
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <FormField id="settings-name" label="Nombre" error={errors.name?.message}>
        {(control) => <Input {...control} autoComplete="organization" {...nameField} />}
      </FormField>
      <SlugField
        id="settings-slug"
        status={slugStatus}
        error={errors.slug?.message}
        inputProps={slugField}
        onUseSuggestion={applySuggestion}
      />
      <FormError error={error} />
      <SubmitButton pending={saving} className="self-start">
        Guardar cambios
      </SubmitButton>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="¿Cambiar la dirección web?"
        description={
          <>
            Los enlaces y códigos QR que ya compartiste con <strong>/r/{restaurant.slug}</strong> dejarán de funcionar. La
            nueva dirección será <strong>/r/{confirming?.slug}</strong>.
          </>
        }
        confirmLabel="Cambiar dirección"
        pending={saving}
        onConfirm={() => confirming && void save(confirming)}
      />
    </form>
  );
}
