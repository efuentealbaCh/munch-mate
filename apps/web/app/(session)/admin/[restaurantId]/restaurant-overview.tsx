"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RoleBadges } from "@/components/role-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { usePublicHost } from "@/hooks/use-slug-availability";
import { useAuth } from "@/lib/auth-context";
import { teamApi } from "@/lib/endpoints";
import { errorMessage } from "@/lib/errors";
import { DeliverySettings } from "./delivery-settings";
import { ItemsLimitSettings, ItemsLimitView } from "./items-limit-settings";
import { OpeningHoursSettings } from "./opening-hours-settings";
import { PickupSettings } from "./pickup-settings";
import { useRestaurant } from "./restaurant-context";
import { ProfileForm } from "./profile-form";
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
              <dd>
                <a
                  href={`/r/${restaurant.slug}`}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-start gap-1.5 rounded-sm font-mono break-all text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span data-testid="public-url">
                    {host}/r/{restaurant.slug}
                  </span>
                  <ExternalLinkIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span className="sr-only">(se abre en una pestaña nueva)</span>
                </a>
              </dd>
            </div>
            <div>
              <dt className="mb-1 text-muted-foreground">Mis roles</dt>
              <dd>
                <RoleBadges roles={restaurant.myRoles} />
              </dd>
            </div>
            {isOwner ? null : (
              <div>
                <dt className="text-muted-foreground">Pedidos para retirar</dt>
                <dd data-testid="pickup-status">{restaurant.pickupEnabled ? "Activados" : "Desactivados (lo cambia el dueño)"}</dd>
              </div>
            )}
            {isOwner ? null : (
              <div>
                <dt className="text-muted-foreground">Delivery</dt>
                <dd data-testid="delivery-status">{restaurant.deliveryEnabled ? "Activado" : "Desactivado (lo cambia el dueño)"}</dd>
              </div>
            )}
            {isOwner ? null : <ItemsLimitView />}
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
          {isOwner ? (
            <>
              <Separator className="my-5" />
              <ItemsLimitSettings />
            </>
          ) : null}
        </CardContent>
      </Card>

      {isOwner ? (
        <div className="flex flex-col gap-6">
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
          <OpeningHoursCard />
          <Card className={CARD_SPACING}>
            <CardHeader>
              <CardTitle>
                <h2>Retiro en local</h2>
              </CardTitle>
              <CardDescription>Pedidos desde tu menú público para retirar en el local.</CardDescription>
            </CardHeader>
            <CardContent>
              <PickupSettings />
            </CardContent>
          </Card>
          <Card className={CARD_SPACING}>
            <CardHeader>
              <CardTitle>
                <h2>Delivery</h2>
              </CardTitle>
              <CardDescription>Pedidos desde tu menú público con despacho a domicilio.</CardDescription>
            </CardHeader>
            <CardContent>
              <DeliverySettings />
            </CardContent>
          </Card>
          <Card className={CARD_SPACING}>
            <CardHeader>
              <CardTitle>
                <h2>Perfil público</h2>
              </CardTitle>
              <CardDescription>Lo que ven tus clientes arriba del menú.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm key={`${restaurant.description}|${restaurant.phone}`} />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <OpeningHoursCard />
          <LeaveCard />
        </div>
      )}
    </div>
  );
}

/** Opening hours: editable by the owner, read-only for the rest of the team. */
function OpeningHoursCard() {
  return (
    <Card className={CARD_SPACING}>
      <CardHeader>
        <CardTitle>
          <h2>Horario de atención</h2>
        </CardTitle>
        <CardDescription>Cuándo pueden pedir tus clientes (QR de mesa, retiro y delivery).</CardDescription>
      </CardHeader>
      <CardContent>
        <OpeningHoursSettings />
      </CardContent>
    </Card>
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
