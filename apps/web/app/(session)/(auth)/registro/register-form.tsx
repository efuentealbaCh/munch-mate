"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { authApi } from "@/lib/endpoints";
import { typedDefaults } from "@/lib/form-defaults";
import { hasCode } from "@/lib/errors";
import { safeNextPath, withQuery } from "@/lib/safe-next";
import { PASSWORD_MIN, type RegisterValues, registerSchema } from "@/lib/validation";

export function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get("next");
  const next = safeNextPath(rawNext);
  const safeRawNext = rawNext && safeNextPath(rawNext, "") ? rawNext : null;
  const prefilledEmail = params.get("email") ?? "";
  const { status, setUser } = useAuth();
  const [error, setError] = useState<unknown>(null);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: typedDefaults("register", { name: "", email: prefilledEmail, password: "" }),
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  async function onSubmit(values: RegisterValues) {
    setError(null);
    try {
      setUser(await authApi.register(values));
    } catch (failure) {
      setError(failure);
    }
  }

  const loginHref = withQuery("/ingresar", { next: safeRawNext });

  return (
    <AuthCard
      title="Crear cuenta"
      description="Con tu cuenta puedes crear tu restaurante o unirte al equipo de uno."
      footer={
        <p>
          ¿Ya tienes cuenta?{" "}
          <Link className="font-medium text-primary underline-offset-4 hover:underline" href={loginHref}>
            Ingresar
          </Link>
        </p>
      }
    >
      <form data-form="register" noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <FormField id="name" label="Nombre" error={errors.name?.message}>
          {(control) => <Input {...control} autoComplete="name" {...form.register("name")} />}
        </FormField>
        <FormField
          id="email"
          label="Correo"
          error={errors.email?.message}
          description={prefilledEmail ? "Usa el correo al que llegó la invitación." : undefined}
        >
          {(control) => (
            <Input {...control} type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
          )}
        </FormField>
        <FormField
          id="password"
          label="Contraseña"
          error={errors.password?.message}
          description={`Al menos ${PASSWORD_MIN} caracteres. Una frase larga es más segura que una clave corta con símbolos.`}
        >
          {(control) => <PasswordInput {...control} autoComplete="new-password" {...form.register("password")} />}
        </FormField>
        <FormError error={error}>
          {hasCode(error, "EMAIL_TAKEN") ? (
            <p className="mt-1">
              <Link className="font-medium underline underline-offset-4" href={loginHref}>
                Ingresa con ese correo
              </Link>{" "}
              o{" "}
              <Link className="font-medium underline underline-offset-4" href="/recuperar-contrasena">
                recupera tu contraseña
              </Link>
              .
            </p>
          ) : null}
        </FormError>
        <SubmitButton pending={isSubmitting} size="lg" className="w-full">
          Crear cuenta
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
