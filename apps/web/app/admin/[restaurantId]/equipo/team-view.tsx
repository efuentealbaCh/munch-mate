"use client";

import { LockIcon } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiQuery } from "@/hooks/use-api-query";
import { teamApi } from "@/lib/endpoints";
import { useRestaurant } from "../restaurant-context";
import { InvitationsList } from "./invitations-list";
import { InviteForm } from "./invite-form";
import { MembersList } from "./members-list";

const CARD_SPACING = "[--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]";

export function TeamView() {
  const { restaurant, isOwner } = useRestaurant();
  if (!isOwner) return <OwnersOnly restaurantId={restaurant.id} />;
  return <OwnerTeam restaurantId={restaurant.id} />;
}

function OwnerTeam({ restaurantId }: { restaurantId: string }) {
  const members = useApiQuery(useCallback(() => teamApi.members(restaurantId), [restaurantId]));
  const invitations = useApiQuery(useCallback(() => teamApi.invitations(restaurantId), [restaurantId]));

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr] lg:items-start">
      <Card className={CARD_SPACING}>
        <CardHeader>
          <CardTitle>
            <h2>Miembros</h2>
          </CardTitle>
          <CardDescription>Marca los roles de cada persona y guarda. Una persona puede tener varios roles.</CardDescription>
        </CardHeader>
        <CardContent>
          <MembersList restaurantId={restaurantId} query={members} />
        </CardContent>
      </Card>
      <div className="flex flex-col gap-6">
        <Card className={CARD_SPACING}>
          <CardHeader>
            <CardTitle>
              <h2>Invitar a alguien</h2>
            </CardTitle>
            <CardDescription>Le enviaremos un correo con un enlace que vence en 24 horas.</CardDescription>
          </CardHeader>
          <CardContent>
            <InviteForm restaurantId={restaurantId} onInvited={invitations.reload} />
          </CardContent>
        </Card>
        <Card className={CARD_SPACING}>
          <CardHeader>
            <CardTitle>
              <h2>Invitaciones pendientes</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <InvitationsList restaurantId={restaurantId} query={invitations} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OwnersOnly({ restaurantId }: { restaurantId: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-12 text-center" role="status">
      <LockIcon className="size-8 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Solo para dueños</h2>
        <p className="text-sm text-muted-foreground">Solo los dueños del restaurante pueden administrar el equipo.</p>
      </div>
      <Button asChild variant="outline">
        <Link href={`/admin/${restaurantId}`}>Volver al resumen</Link>
      </Button>
    </div>
  );
}
