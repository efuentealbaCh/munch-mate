"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { authApi } from "@/lib/endpoints";
import { safeNextPath, withQuery } from "@/lib/safe-next";
import { type LoginValues, loginSchema } from "@/lib/validation";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get("next");
  const next = safeNextPath(rawNext);
  const { status, setUser } = useAuth();
  const [error, setError] = useState<unknown>(null);

  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  // Already logged in (or just logged in): go where the user was heading.
  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  async function onSubmit(values: LoginValues) {
    setError(null);
    try {
      setUser(await authApi.login(values));
    } catch (failure) {
      setError(failure);
    }
  }

  const safeRawNext = rawNext && safeNextPath(rawNext, "") ? rawNext : null;

  return (
    <AuthCard
      title="Ingresar"
      description="Entra con tu correo y contraseña."
      footer={
        <p>
          ¿No tienes cuenta?{" "}
          <Link className="font-medium text-primary underline-offset-4 hover:underline" href={withQuery("/registro", { next: safeRawNext })}>
            Crear cuenta
          </Link>
        </p>
      }
    >
      {params.get("reset") === "1" ? (
        <Alert className="border-success/30 bg-success/5">
          <CircleCheckIcon className="text-success" aria-hidden />
          <AlertDescription className="text-foreground">
            Tu contraseña se actualizó y cerramos tus sesiones abiertas. Ingresa con la nueva contraseña.
          </AlertDescription>
        </Alert>
      ) : null}
      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <FormField id="email" label="Correo" error={errors.email?.message}>
          {(control) => (
            <Input {...control} type="email" autoComplete="email" inputMode="email" {...form.register("email")} />
          )}
        </FormField>
        <FormField id="password" label="Contraseña" error={errors.password?.message}>
          {(control) => <PasswordInput {...control} autoComplete="current-password" {...form.register("password")} />}
        </FormField>
        <div className="-mt-2 text-sm">
          <Link className="text-primary underline-offset-4 hover:underline" href="/recuperar-contrasena">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        <FormError error={error} />
        <SubmitButton pending={isSubmitting} size="lg" className="w-full">
          Ingresar
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
