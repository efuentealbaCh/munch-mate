"use client";

import type { RestaurantView } from "@app/types";
import { ArrowLeftIcon, LayoutDashboardIcon, SearchXIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { type ReactNode, useCallback, useMemo } from "react";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { restaurantsApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { RestaurantContext, type RestaurantContextValue } from "./restaurant-context";

/** Loads the restaurant once for every page under /admin/[restaurantId] and renders the section tabs. */
export function RestaurantShell({ children }: { children: ReactNode }) {
  const { restaurantId } = useParams<{ restaurantId: string }>();
  const load = useCallback(() => restaurantsApi.get(restaurantId), [restaurantId]);
  const { data, error, loading, reload, setData } = useApiQuery<RestaurantView>(load);

  const context = useMemo<RestaurantContextValue | null>(
    () =>
      data
        ? { restaurant: data, isOwner: data.myRoles.includes("owner"), setRestaurant: setData, reload }
        : null,
    [data, setData, reload],
  );

  if (hasCode(error, "RESTAURANT_NOT_FOUND")) return <NotFound />;

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

  if (!context || (loading && !data)) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando restaurante">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { restaurant, isOwner } = context;
  return (
    <RestaurantContext.Provider value={context}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
            <Link href="/admin">
              <ArrowLeftIcon aria-hidden data-icon="inline-start" />
              Mis restaurantes
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight break-words">{restaurant.name}</h1>
            {restaurant.status === "suspended" ? <Badge variant="destructive">Suspendido</Badge> : null}
          </div>
          <SectionTabs restaurantId={restaurant.id} isOwner={isOwner} />
        </div>
        {children}
      </div>
    </RestaurantContext.Provider>
  );
}

function SectionTabs({ restaurantId, isOwner }: { restaurantId: string; isOwner: boolean }) {
  const pathname = usePathname();
  const base = `/admin/${restaurantId}`;
  const tabs = [
    { href: base, label: "Resumen", icon: LayoutDashboardIcon },
    // Team management is owner-only (the api would answer 403 anyway).
    ...(isOwner ? [{ href: `${base}/equipo`, label: "Equipo", icon: UsersIcon }] : []),
  ];

  return (
    <nav aria-label="Secciones del restaurante" className="-mx-4 overflow-x-auto border-b px-4">
      <ul className="flex gap-1">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-12 text-center" role="alert">
      <SearchXIcon className="size-10 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Restaurante no encontrado</h1>
        <p className="text-sm text-muted-foreground">No existe o no eres parte de su equipo.</p>
      </div>
      <Button asChild>
        <Link href="/admin">Volver a mis restaurantes</Link>
      </Button>
    </div>
  );
}
