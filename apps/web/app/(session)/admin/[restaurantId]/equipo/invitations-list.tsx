"use client";

import type { InvitationView } from "@app/types";
import { useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { RoleBadges } from "@/components/role-badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { ApiQuery } from "@/hooks/use-api-query";
import { teamApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";

export function InvitationsList({ restaurantId, query }: { restaurantId: string; query: ApiQuery<InvitationView[]> }) {
  const { data, error, loading, reload, setData } = query;
  const [revoking, setRevoking] = useState<string | null>(null);

  async function revoke(invitation: InvitationView) {
    setRevoking(invitation.id);
    try {
      await teamApi.revokeInvitation(restaurantId, invitation.id);
      toast.success(`Invitación a ${invitation.email} revocada`);
      setData((list) => list?.filter((i) => i.id !== invitation.id));
    } catch (failure) {
      toast.error(errorMessage(failure));
      // Already accepted/revoked/expired: it is no longer pending either way.
      if (hasCode(failure, "INVITATION_NOT_FOUND")) setData((list) => list?.filter((i) => i.id !== invitation.id));
    } finally {
      setRevoking(null);
    }
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormError error={error} />
        <Button variant="outline" size="sm" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (loading && !data) return <Skeleton className="h-16 w-full" aria-label="Cargando invitaciones" />;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No hay invitaciones pendientes.</p>;

  return (
    <ul className="flex flex-col divide-y" aria-label="Invitaciones pendientes">
      {data.map((invitation) => (
        <li key={invitation.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="font-medium break-all">{invitation.email}</span>
            <RoleBadges roles={invitation.roles} />
            <span className="text-xs text-muted-foreground">
              {invitation.invitedByName ? `Invitado por ${invitation.invitedByName} · ` : ""}Vence{" "}
              {formatDateTime(invitation.expiresAt)}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={revoking === invitation.id}
            aria-label={`Revocar invitación a ${invitation.email}`}
            onClick={() => void revoke(invitation)}
          >
            {revoking === invitation.id ? <Spinner aria-hidden /> : null}
            Revocar
          </Button>
        </li>
      ))}
    </ul>
  );
}
