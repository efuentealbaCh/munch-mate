"use client";

import { ChevronRightIcon, PlusIcon, ReceiptTextIcon, StoreIcon, UserRoundIcon } from "lucide-react";
import Link from "next/link";
import { FormError } from "@/components/form-error";
import { RestaurantLogo } from "@/components/restaurant-logo";
import { RoleBadges } from "@/components/role-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { restaurantsApi } from "@/lib/endpoints";
import { restaurantHomeHref } from "@/lib/orders-board";

export function RestaurantList() {
  const { data, error, loading, reload } = useApiQuery(restaurantsApi.list);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Mis restaurantes</h1>
        {data && data.length > 0 ? (
          <Button asChild>
            <Link href="/admin/nuevo">
              <PlusIcon aria-hidden data-icon="inline-start" />
              Nuevo restaurante
            </Link>
          </Button>
        ) : null}
      </div>

      {error ? (
        <div className="flex flex-col items-start gap-3">
          <FormError error={error} />
          <Button variant="outline" onClick={reload}>
            Reintentar
          </Button>
        </div>
      ) : loading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Cargando restaurantes">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : data && data.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {data?.map((restaurant) => (
            <li key={restaurant.id}>
              <Link
                href={restaurantHomeHref(restaurant)}
                className="group flex h-full items-start gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10 transition-shadow outline-none hover:shadow-md hover:ring-primary/30 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <RestaurantLogo logo={restaurant.logo} />
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-base font-semibold">{restaurant.name}</span>
                    {restaurant.status === "suspended" ? <Badge variant="destructive">Suspendido</Badge> : null}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">/r/{restaurant.slug}</span>
                  <RoleBadges roles={restaurant.myRoles} />
                </span>
                <ChevronRightIcon className="mt-3 size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-soft-foreground" aria-hidden>
        <StoreIcon className="size-7" />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-lg font-semibold">Aún no tienes restaurantes</h2>
        <p className="text-sm text-muted-foreground">
          Crea el tuyo para armar tu menú y empezar a recibir pedidos. Si te invitaron a un equipo, abre el enlace del correo
          de invitación.
        </p>
      </div>
      <Button asChild size="lg">
        <Link href="/admin/nuevo">
          <PlusIcon aria-hidden data-icon="inline-start" />
          Crear mi restaurante
        </Link>
      </Button>
      {/* Customers land here after logging in too: ordering never requires a restaurant. */}
      <div className="mt-2 flex w-full max-w-sm flex-col gap-2 border-t pt-5" data-testid="customer-shortcuts">
        <p className="text-sm text-muted-foreground">¿Solo quieres pedir? Revisa tus pedidos y tus datos de entrega.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild variant="outline">
            <Link href="/mis-pedidos">
              <ReceiptTextIcon aria-hidden data-icon="inline-start" />
              Mis pedidos
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/mi-cuenta">
              <UserRoundIcon aria-hidden data-icon="inline-start" />
              Mi cuenta
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
