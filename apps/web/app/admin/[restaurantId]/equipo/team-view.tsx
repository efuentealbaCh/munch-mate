"use client";

import { useCallback } from "react";
import { AccessDenied } from "@/components/access-denied";
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
  if (!isOwner) {
    return (
      <AccessDenied
        restaurantId={restaurant.id}
        description="Solo los dueños del restaurante pueden administrar el equipo."
      />
    );
  }
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
