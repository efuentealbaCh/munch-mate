"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RoleBadges } from "@/components/role-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePublicHost } from "@/hooks/use-slug-availability";
import { useAuth } from "@/lib/auth-context";
import { teamApi } from "@/lib/endpoints";
import { errorMessage } from "@/lib/errors";
import { useRestaurant } from "./restaurant-context";
import { SettingsForm } from "./settings-form";

const CARD_SPACING = "[--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]";

export function RestaurantOverview() {
  const { restaurant, isOwner } = useRestaurant();
  const host = usePublicHost();

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_3fr] lg:items-start">
      <Card className={CARD_SPACING}>
        <CardHeader>
          <CardTitle>
            <h2>Resumen</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Dirección pública</dt>
              <dd className="font-mono break-all" data-testid="public-url">
                {host}/r/{restaurant.slug}
              </dd>
              <dd className="mt-1 text-xs text-muted-foreground">El menú público estará disponible pronto.</dd>
            </div>
            <div>
              <dt className="mb-1 text-muted-foreground">Mis roles</dt>
              <dd>
                <RoleBadges roles={restaurant.myRoles} />
              </dd>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-muted-foreground">Moneda</dt>
                <dd>{restaurant.currency}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Zona horaria</dt>
                <dd>{restaurant.timezone}</dd>
              </div>
            </div>
          </dl>
        </CardContent>
      </Card>

      {isOwner ? (
        <Card className={CARD_SPACING}>
          <CardHeader>
            <CardTitle>
              <h2>Configuración</h2>
            </CardTitle>
            <CardDescription>Nombre y dirección web del restaurante.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Remount after each save so the form starts from the stored values. */}
            <SettingsForm key={`${restaurant.name}|${restaurant.slug}`} />
          </CardContent>
        </Card>
      ) : (
        <LeaveCard />
      )}
    </div>
  );
}

/** Non-owners can leave the restaurant from here (owners do it from the team page). */
function LeaveCard() {
  const router = useRouter();
  const { user } = useAuth();
  const { restaurant } = useRestaurant();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function leave() {
    if (!user) return;
    setPending(true);
    try {
      await teamApi.removeMember(restaurant.id, user.id);
      toast.success(`Saliste de ${restaurant.name}`);
      router.replace("/admin");
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
      setOpen(false);
    }
  }

  return (
    <Card className={CARD_SPACING}>
      <CardHeader>
        <CardTitle>
          <h2>Salir del restaurante</h2>
        </CardTitle>
        <CardDescription>Dejarás de ver este restaurante. Para volver necesitarás una nueva invitación.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Salir del restaurante
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={`¿Salir de ${restaurant.name}?`}
          description="Perderás el acceso de inmediato."
          confirmLabel="Salir"
          destructive
          pending={pending}
          onConfirm={() => void leave()}
        />
      </CardContent>
    </Card>
  );
}
