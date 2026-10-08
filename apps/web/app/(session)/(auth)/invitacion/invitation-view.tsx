"use client";

import type { InvitationPreview } from "@app/types";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { AuthCard, AuthCardSkeleton } from "@/components/auth-card";
import { FormError } from "@/components/form-error";
import { RoleBadges } from "@/components/role-badges";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useAuth } from "@/lib/auth-context";
import { invitationsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { restaurantHomeHref } from "@/lib/orders-board";
import { withQuery } from "@/lib/safe-next";

export function InvitationView() {
  const token = useSearchParams().get("token");
  const load = useCallback(
    () => (token ? invitationsApi.preview(token) : Promise.reject(new Error("missing token"))),
    [token],
  );
  const preview = useApiQuery<InvitationPreview>(load);

  if (!token || hasCode(preview.error, "INVALID_TOKEN", "VALIDATION_FAILED")) {
    return (
      <AuthCard
        title="Invitación no válida"
        description="La invitación no es válida, ya se usó, fue revocada o expiró (dura 24 horas)."
      >
        <p className="text-sm text-muted-foreground">Pídele a quien te invitó que te envíe una nueva.</p>
        <Button asChild variant="outline" size="lg" className="w-full">
          <Link href="/">Ir al inicio</Link>
        </Button>
      </AuthCard>
    );
  }

  if (preview.error) {
    return (
      <AuthCard title="No pudimos cargar la invitación">
        <FormError error={preview.error} />
        <Button size="lg" className="w-full" onClick={preview.reload}>
          Reintentar
        </Button>
      </AuthCard>
    );
  }

  if (!preview.data) return <AuthCardSkeleton />;
  return <InvitationDetails token={token} invitation={preview.data} />;
}

function InvitationDetails({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const router = useRouter();
  const { status, user, logout, syncSession } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const here = withQuery("/invitacion", { token });

  async function accept() {
    setPending(true);
    setError(null);
    try {
      const restaurant = await invitationsApi.accept(token);
      // Accepting also verifies the email: refresh so the session reflects it.
      await syncSession().catch(() => undefined);
      toast.success(`Te uniste a ${restaurant.name}`);
      // Riders without floor roles land on their deliveries, everyone else on the summary.
      router.push(restaurantHomeHref(restaurant));
    } catch (failure) {
      setError(failure);
      setPending(false);
    }
  }

  async function switchAccount() {
    setPending(true);
    setError(null);
    try {
      await logout();
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setPending(false);
    }
  }

  const summary = (
    <dl className="grid gap-3 rounded-lg bg-muted/60 p-4 text-sm">
      <div>
        <dt className="text-muted-foreground">Restaurante</dt>
        <dd className="text-base font-semibold">{invitation.restaurantName}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Para</dt>
        <dd className="font-medium break-all">{invitation.email}</dd>
      </div>
      <div>
        <dt className="mb-1 text-muted-foreground">Roles</dt>
        <dd>
          <RoleBadges roles={invitation.roles} />
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Vence</dt>
        <dd>{formatDateTime(invitation.expiresAt)}</dd>
      </div>
    </dl>
  );

  const title = `Te invitaron a ${invitation.restaurantName}`;

  if (status === "loading") {
    return (
      <AuthCard title={title}>
        {summary}
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner aria-hidden /> Revisando tu sesión…
        </p>
      </AuthCard>
    );
  }

  if (status !== "authenticated" || !user) {
    return (
      <AuthCard title={title} description="Para unirte al equipo necesitas una cuenta con el correo invitado.">
        {summary}
        <div className="flex flex-col gap-3">
          <Button asChild size="lg" className="w-full">
            <Link href={withQuery("/registro", { email: invitation.email, next: here })}>Crear cuenta</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link href={withQuery("/ingresar", { next: here })}>Ya tengo cuenta</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <AuthCard title={title}>
        {summary}
        <p className="text-sm" role="alert">
          Iniciaste sesión como <strong className="break-all">{user.email}</strong>, pero la invitación es para{" "}
          <strong className="break-all">{invitation.email}</strong>. Cierra sesión y entra (o crea una cuenta) con el
          correo invitado.
        </p>
        <Button size="lg" className="w-full" disabled={pending} onClick={() => void switchAccount()}>
          {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          Cerrar sesión y continuar
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title} description={`Entrarás como ${user.name}.`}>
      {summary}
      <FormError error={error} />
      <Button size="lg" className="w-full" disabled={pending} aria-busy={pending || undefined} onClick={() => void accept()}>
        {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
        Aceptar invitación
      </Button>
    </AuthCard>
  );
}
