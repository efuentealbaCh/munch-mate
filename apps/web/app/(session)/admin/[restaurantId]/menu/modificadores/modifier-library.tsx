"use client";

import type { AdminMenuView, ModifierGroupView } from "@app/types";
import { ListPlusIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { menuApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { modifierRuleSummary } from "@/lib/menu";
import { formatPriceDelta } from "@/lib/money";
import { useRestaurant } from "../../restaurant-context";
import { MenuNav } from "../menu-nav";
import { ModifierGroupSheet } from "./modifier-group-sheet";

export function ModifierLibrary() {
  const { restaurant, isOwner } = useRestaurant();
  if (!isOwner) {
    return (
      <AccessDenied
        restaurantId={restaurant.id}
        description="Solo los dueños pueden editar los modificadores. Para marcar opciones agotadas usa Disponibilidad."
      />
    );
  }
  return <OwnerLibrary restaurantId={restaurant.id} slug={restaurant.slug} currency={restaurant.currency} />;
}

function usedByText(count: number): string {
  if (count === 0) return "No se usa en ningún producto";
  return count === 1 ? "Usado en 1 producto" : `Usado en ${count} productos`;
}

function OwnerLibrary({ restaurantId, slug, currency }: { restaurantId: string; slug: string; currency: string }) {
  const { data, error, loading, reload, setData } = useApiQuery<AdminMenuView>(
    useCallback(() => menuApi.get(restaurantId), [restaurantId]),
  );
  /** undefined = sheet closed, null = new group. */
  const [editing, setEditing] = useState<ModifierGroupView | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ModifierGroupView | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  if (error && !data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormError error={error} />
        <Button variant="outline" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if ((loading && !data) || !data) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando modificadores">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  const groups = data.modifierGroups;

  function saveGroup(saved: ModifierGroupView, created: boolean) {
    setData((menu) =>
      menu && {
        ...menu,
        modifierGroups: created
          ? [...menu.modifierGroups, saved]
          : menu.modifierGroups.map((group) => (group.id === saved.id ? saved : group)),
      },
    );
  }

  async function deleteGroup() {
    if (!deleting) return;
    setDeletePending(true);
    try {
      await menuApi.deleteModifierGroup(restaurantId, deleting.id);
      toast.success(`Grupo «${deleting.name}» eliminado`);
      // Products lose the reference on the server; reload so every count is right.
      reload();
    } catch (failure) {
      toast.error(errorMessage(failure));
      if (hasCode(failure, "MODIFIER_GROUP_NOT_FOUND")) reload();
    } finally {
      setDeletePending(false);
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <MenuNav restaurantId={restaurantId} slug={slug} current="modifiers" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">Modificadores</h2>
          <p className="text-sm text-muted-foreground">Grupos de opciones que puedes usar en varios productos.</p>
        </div>
        {groups.length > 0 ? (
          <Button onClick={() => setEditing(null)}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            Nuevo grupo
          </Button>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-soft-foreground" aria-hidden>
            <ListPlusIcon className="size-7" />
          </span>
          <div className="flex max-w-sm flex-col gap-1">
            <h3 className="text-lg font-semibold">Aún no tienes modificadores</h3>
            <p className="text-sm text-muted-foreground">
              Crea un grupo como «Tamaño» (Chico, Grande +$800) y asígnalo a tus productos desde el editor del menú.
            </p>
          </div>
          <Button size="lg" onClick={() => setEditing(null)}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            Crear grupo
          </Button>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" aria-label="Grupos de opciones">
          {groups.map((group) => (
            <li key={group.id} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10" data-testid="modifier-group">
              <div className="flex flex-col gap-0.5">
                <h3 className="font-semibold break-words">{group.name}</h3>
                <p className="text-sm font-medium text-brand-soft-foreground">{modifierRuleSummary(group.minSelect, group.maxSelect)}</p>
              </div>
              <ul className="flex flex-col gap-1 text-sm" aria-label={`Opciones de ${group.name}`}>
                {group.options.map((option) => (
                  <li key={option.id} className="flex justify-between gap-2">
                    <span className="min-w-0 break-words">
                      {option.name}
                      {option.available ? null : <span className="text-destructive"> · Agotado</span>}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{formatPriceDelta(option.priceDelta, currency)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{usedByText(group.usedByProducts)}</p>
              <div className="mt-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(group)} aria-label={`Editar ${group.name}`}>
                  <PencilIcon aria-hidden data-icon="inline-start" />
                  Editar
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleting(group)} aria-label={`Eliminar ${group.name}`}>
                  <Trash2Icon aria-hidden data-icon="inline-start" />
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ModifierGroupSheet
        restaurantId={restaurantId}
        group={editing}
        onClose={() => setEditing(undefined)}
        onSaved={saveGroup}
        onStale={reload}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`¿Eliminar el grupo «${deleting?.name ?? ""}»?`}
        description={
          deleting && deleting.usedByProducts > 0
            ? `Se quitará de ${deleting.usedByProducts === 1 ? "1 producto" : `${deleting.usedByProducts} productos`}. No se puede deshacer.`
            : "Ningún producto lo usa. No se puede deshacer."
        }
        confirmLabel="Eliminar"
        destructive
        pending={deletePending}
        onConfirm={() => void deleteGroup()}
      />
    </div>
  );
}
