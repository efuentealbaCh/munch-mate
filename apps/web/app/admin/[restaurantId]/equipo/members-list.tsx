"use client";

import type { MemberView, RestaurantRole } from "@app/types";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { RoleCheckboxes } from "@/components/role-checkboxes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { ApiQuery } from "@/hooks/use-api-query";
import { useAuth } from "@/lib/auth-context";
import { teamApi } from "@/lib/endpoints";
import { formatDate } from "@/lib/format";
import { useRestaurant } from "../restaurant-context";

export function MembersList({ restaurantId, query }: { restaurantId: string; query: ApiQuery<MemberView[]> }) {
  const { data, error, loading, reload, setData } = query;

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
  if (loading && !data) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando miembros">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y" aria-label="Miembros">
      {data?.map((member) => (
        <MemberRow
          key={member.userId}
          restaurantId={restaurantId}
          member={member}
          onSaved={(roles) =>
            setData((list) => list?.map((m) => (m.userId === member.userId ? { ...m, roles } : m)))
          }
          onRemoved={() => setData((list) => list?.filter((m) => m.userId !== member.userId))}
        />
      ))}
    </ul>
  );
}

function sameRoles(a: readonly RestaurantRole[], b: readonly RestaurantRole[]): boolean {
  return a.length === b.length && a.every((role) => b.includes(role));
}

interface MemberRowProps {
  restaurantId: string;
  member: MemberView;
  onSaved(roles: RestaurantRole[]): void;
  onRemoved(): void;
}

/** One member: role toggles saved per row, and remove (or "leave" for oneself) behind a confirmation. */
function MemberRow({ restaurantId, member, onSaved, onRemoved }: MemberRowProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { restaurant, reload: reloadRestaurant } = useRestaurant();
  const isSelf = user?.id === member.userId;
  const [roles, setRoles] = useState<RestaurantRole[]>(member.roles);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dirty = !sameRoles(roles, member.roles);
  const rowId = `member-${member.userId}`;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await teamApi.updateRoles(restaurantId, member.userId, roles);
      toast.success(`Roles de ${member.name} actualizados`);
      onSaved(roles);
      // Dropping my own owner role changes what I may see on these pages.
      if (isSelf && !roles.includes("owner")) reloadRestaurant();
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      await teamApi.removeMember(restaurantId, member.userId);
      if (isSelf) {
        toast.success(`Saliste de ${restaurant.name}`);
        router.replace("/admin");
        return;
      }
      toast.success(`${member.name} ya no es parte del equipo`);
      setConfirmOpen(false);
      onRemoved();
    } catch (failure) {
      setConfirmOpen(false);
      setError(failure);
      setRemoving(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0" aria-labelledby={`${rowId}-name`} data-testid="member-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span id={`${rowId}-name`} className="flex items-center gap-2 font-medium">
            {member.name}
            {isSelf ? <Badge variant="outline">Tú</Badge> : null}
          </span>
          <span className="text-sm break-all text-muted-foreground">{member.email}</span>
          <span className="text-xs text-muted-foreground">Desde {formatDate(member.joinedAt)}</span>
        </div>
      </div>
      <RoleCheckboxes
        idPrefix={`${rowId}-role`}
        legend={`Roles de ${member.name}`}
        hideLegend
        value={roles}
        onChange={setRoles}
        disabled={saving || removing}
      />
      {roles.length === 0 ? <p className="text-sm text-destructive">Elige al menos un rol.</p> : null}
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!dirty || roles.length === 0 || saving} onClick={() => void save()}>
          {saving ? <Spinner aria-hidden /> : null}
          Guardar roles
        </Button>
        {dirty ? (
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => setRoles(member.roles)}>
            Deshacer
          </Button>
        ) : null}
        <Button size="sm" variant="destructive" className="ml-auto" disabled={removing} onClick={() => setConfirmOpen(true)}>
          {isSelf ? "Salir" : "Quitar"}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={isSelf ? `¿Salir de ${restaurant.name}?` : `¿Quitar a ${member.name}?`}
        description={
          isSelf
            ? "Perderás el acceso de inmediato. Para volver necesitarás una nueva invitación."
            : `${member.name} perderá el acceso de inmediato. Puedes volver a invitarle cuando quieras.`
        }
        confirmLabel={isSelf ? "Salir" : "Quitar"}
        destructive
        pending={removing}
        onConfirm={() => void remove()}
      />
    </li>
  );
}

