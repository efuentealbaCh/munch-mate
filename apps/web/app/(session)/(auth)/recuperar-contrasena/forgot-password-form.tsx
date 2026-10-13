"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { authApi } from "@/lib/endpoints";
import { typedDefaults } from "@/lib/form-defaults";
import { type ForgotPasswordValues, forgotPasswordSchema } from "@/lib/validation";

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: typedDefaults("forgot-password", { email: "" }),
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit({ email }: ForgotPasswordValues) {
    setError(null);
    try {
      await authApi.forgotPassword(email);
      setSentTo(email);
    } catch (failure) {
      setError(failure);
    }
  }

  const footer = (
    <p>
      <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/ingresar">
        Volver a ingresar
      </Link>
    </p>
  );

  if (sentTo) {
    return (
      <AuthCard title="Revisa tu correo" footer={footer}>
        <div aria-live="polite">
          <Alert className="border-success/30 bg-success/5">
            <MailCheckIcon className="text-success" aria-hidden />
            <AlertTitle>Solicitud recibida</AlertTitle>
            <AlertDescription>
              Si existe una cuenta con <strong className="text-foreground">{sentTo}</strong>, te enviamos un correo con un
              enlace para crear una nueva contraseña. El enlace vence en 24 horas.
            </AlertDescription>
          </Alert>
        </div>
        <p className="text-sm text-muted-foreground">¿No llegó? Revisa la carpeta de spam o vuelve a intentarlo en unos minutos.</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Recuperar contraseña"
      description="Escribe el correo de tu cuenta y te enviaremos un enlace para crear una nueva contraseña."
      footer={footer}
    >
      <form data-form="forgot-password" noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <FormField id="email" label="Correo" error={errors.email?.message}>
          {(control) => (
            <Input {...control} type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
          )}
        </FormField>
        <FormError error={error} />
        <SubmitButton pending={isSubmitting} size="lg" className="w-full">
          Enviar enlace
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
