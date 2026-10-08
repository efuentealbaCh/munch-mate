"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SlugField } from "@/components/slug-field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRestaurantForm } from "@/hooks/use-restaurant-form";
import { authApi, restaurantsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { slugStatusAllowsSubmit } from "@/lib/slug-field";
import type { RestaurantValues } from "@/lib/validation";

export function NewRestaurantForm() {
  const router = useRouter();
  const { form, slugStatus, markTaken, nameField, slugField, applySuggestion } = useRestaurantForm();
  const { errors, isSubmitting } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const [resending, setResending] = useState(false);

  async function onSubmit(values: RestaurantValues) {
    setError(null);
    // The api decides in the end; this only avoids a request that is known to fail.
    if (!slugStatusAllowsSubmit(slugStatus)) {
      form.setFocus("slug");
      return;
    }
    try {
      // Always send the slug shown: it is what the owner saw and accepted.
      const restaurant = await restaurantsApi.create(values);
      toast.success(`¡${restaurant.name} está listo!`);
      router.push(`/admin/${restaurant.id}`);
    } catch (failure) {
      if (hasCode(failure, "SLUG_TAKEN")) {
        markTaken(values.slug, failure.meta?.suggestion);
        form.setFocus("slug");
      } else if (hasCode(failure, "INVALID_SLUG")) {
        form.setError("slug", { message: failure.message }, { shouldFocus: true });
      } else {
        setError(failure);
      }
    }
  }

  async function resend() {
    setResending(true);
    try {
      await authApi.resendVerification();
      toast.success("Te enviamos un nuevo enlace de confirmación");
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href="/admin">
          <ArrowLeftIcon aria-hidden data-icon="inline-start" />
          Mis restaurantes
        </Link>
      </Button>
      <Card className="gap-6 py-6 [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]">
        <CardHeader>
          <h1 className="text-xl font-semibold tracking-tight">Crea tu restaurante</h1>
          <CardDescription>Podrás cambiar el nombre y la dirección más adelante.</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
            <FormField id="name" label="Nombre del restaurante" error={errors.name?.message}>
              {(control) => <Input {...control} autoComplete="organization" placeholder="Ej: La Picá de Ñuñoa" {...nameField} />}
            </FormField>
            <SlugField
              id="slug"
              status={slugStatus}
              error={errors.slug?.message}
              inputProps={slugField}
              onUseSuggestion={applySuggestion}
            />
            <FormError error={error}>
              {hasCode(error, "EMAIL_NOT_VERIFIED") ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={resending}
                  onClick={() => void resend()}
                >
                  Reenviar correo de confirmación
                </Button>
              ) : null}
            </FormError>
            <SubmitButton pending={isSubmitting} size="lg" className="w-full sm:w-auto sm:self-end">
              Crear restaurante
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
