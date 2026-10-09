"use client";

import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth-context";
import { authApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";

type State = { kind: "verifying" } | { kind: "verified" } | { kind: "invalid" } | { kind: "error"; error: unknown };

/**
 * Tokens are single-use: React StrictMode (dev) runs effects twice, and a second POST would turn a
 * success into INVALID_TOKEN. Requests are therefore shared per token for the life of the page.
 */
const inFlight = new Map<string, Promise<void>>();

function verifyOnce(token: string): Promise<void> {
  let request = inFlight.get(token);
  if (!request) {
    request = authApi.verifyEmail(token);
    inFlight.set(token, request);
    // Allow a manual retry after a transient failure.
    request.catch(() => inFlight.delete(token));
  }
  return request;
}

export function VerifyEmail() {
  const token = useSearchParams().get("token");
  const { status, syncSession } = useAuth();
  const [state, setState] = useState<State>(token ? { kind: "verifying" } : { kind: "invalid" });

  const run = useCallback(
    async (value: string) => {
      setState({ kind: "verifying" });
      try {
        await verifyOnce(value);
      } catch (error) {
        setState(hasCode(error, "INVALID_TOKEN", "VALIDATION_FAILED") ? { kind: "invalid" } : { kind: "error", error });
        return;
      }
      // If there is a session, its access token still says "not verified": rotate it to pick up the change.
      // No session (opened on another device) is fine too.
      await syncSession().catch(() => undefined);
      setState({ kind: "verified" });
    },
    [syncSession],
  );

  useEffect(() => {
    if (token) void run(token);
  }, [token, run]);

  if (state.kind === "verifying") {
    return (
      <AuthCard title="Confirmando tu correo…">
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner aria-hidden /> Un momento, estamos validando el enlace.
        </p>
      </AuthCard>
    );
  }

  if (state.kind === "verified") {
    const loggedIn = status === "authenticated";
    return (
      <AuthCard title="Correo confirmado">
        <p className="flex items-start gap-2 text-sm" role="status">
          <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          ¡Listo! Tu correo quedó confirmado. Ya puedes crear tu restaurante.
        </p>
        <Button asChild size="lg" className="w-full">
          <Link href={loggedIn ? "/admin" : "/ingresar?next=%2Fadmin"}>{loggedIn ? "Ir al panel" : "Ingresar"}</Link>
        </Button>
      </AuthCard>
    );
  }

  if (state.kind === "invalid") {
    return (
      <AuthCard title="Enlace no válido">
        <p className="flex items-start gap-2 text-sm" role="alert">
          <CircleXIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          El enlace no es válido, ya se usó o expiró (dura 24 horas). Si ya confirmaste tu correo, no necesitas hacer nada más.
        </p>
        <p className="text-sm text-muted-foreground">
          Para recibir un enlace nuevo, ingresa a tu cuenta y usa «Reenviar correo» en el panel.
        </p>
        <Button asChild size="lg" className="w-full">
          <Link href="/admin">Ir al panel</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="No pudimos confirmar tu correo">
      <FormError error={state.error} />
      <Button size="lg" className="w-full" onClick={() => token && void run(token)}>
        Reintentar
      </Button>
    </AuthCard>
  );
}
