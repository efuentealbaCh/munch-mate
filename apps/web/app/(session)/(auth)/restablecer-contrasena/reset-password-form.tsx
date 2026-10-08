"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { authApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { PASSWORD_MIN, type ResetPasswordValues, resetPasswordSchema } from "@/lib/validation";

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const { setUser } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;

  if (!token || hasCode(error, "INVALID_TOKEN")) {
    return (
      <AuthCard
        title="Enlace no válido"
        description="El enlace para cambiar la contraseña no es válido, ya se usó o expiró (dura 24 horas)."
      >
        <Button asChild size="lg" className="w-full">
          <Link href="/recuperar-contrasena">Pedir un enlace nuevo</Link>
        </Button>
      </AuthCard>
    );
  }

  async function onSubmit({ password }: ResetPasswordValues) {
    if (!token) return;
    setError(null);
    try {
      await authApi.resetPassword(token, password);
      // The api revoked every session (including this browser's), so the user logs in again.
      setUser(null);
      router.replace("/ingresar?reset=1");
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <AuthCard title="Crea una nueva contraseña" description="Al guardarla se cerrarán tus sesiones en todos los dispositivos.">
      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <FormField
          id="password"
          label="Nueva contraseña"
          error={errors.password?.message}
          description={`Al menos ${PASSWORD_MIN} caracteres.`}
        >
          {(control) => <PasswordInput {...control} autoComplete="new-password" {...form.register("password")} />}
        </FormField>
        <FormField id="confirm" label="Repite la contraseña" error={errors.confirm?.message}>
          {(control) => <PasswordInput {...control} autoComplete="new-password" {...form.register("confirm")} />}
        </FormField>
        <FormError error={error} />
        <SubmitButton pending={isSubmitting} size="lg" className="w-full">
          Guardar contraseña
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
