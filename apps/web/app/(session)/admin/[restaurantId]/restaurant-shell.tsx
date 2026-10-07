"use client";

import type { RestaurantRole, RestaurantView } from "@app/types";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  ClipboardListIcon,
  LayoutDashboardIcon,
  PackageCheckIcon,
  QrCodeIcon,
  SearchXIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { type ReactNode, useCallback, useMemo } from "react";
import { FormError } from "@/components/form-error";
import { RestaurantLogo } from "@/components/restaurant-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { restaurantsApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { canManageAvailability } from "@/lib/menu";
import { canWorkOrders } from "@/lib/orders-board";
import { cn } from "@/lib/utils";
import { RestaurantContext, type RestaurantContextValue } from "./restaurant-context";
import { RestaurantRealtimeProvider } from "./restaurant-realtime";

/** Loads the restaurant once for every page under /admin/[restaurantId] and renders the section tabs. */
export function RestaurantShell({ children }: { children: ReactNode }) {
  const { restaurantId } = useParams<{ restaurantId: string }>();
  const load = useCallback(() => restaurantsApi.get(restaurantId), [restaurantId]);
  const { data, error, loading, reload, setData } = useApiQuery<RestaurantView>(load);
  const setAccepting = useCallback(
    (acceptingOrders: boolean) => setData((current) => current && { ...current, acceptingOrders }),
    [setData],
  );

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
      {/* Reconnected after a gap: the open/closed state may have changed meanwhile. */}
      <RestaurantRealtimeProvider restaurantId={restaurant.id} onAccepting={setAccepting} onResync={reload}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
              <Link href="/admin">
                <ArrowLeftIcon aria-hidden data-icon="inline-start" />
                Mis restaurantes
              </Link>
            </Button>
            <div className="flex items-center gap-3">
              <RestaurantLogo logo={restaurant.logo} size="md" />
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight break-words">{restaurant.name}</h1>
                {restaurant.status === "suspended" ? <Badge variant="destructive">Suspendido</Badge> : null}
                <OpenBadge open={restaurant.acceptingOrders} />
              </div>
            </div>
            <SectionTabs restaurantId={restaurant.id} isOwner={isOwner} roles={restaurant.myRoles} />
          </div>
          {children}
        </div>
      </RestaurantRealtimeProvider>
    </RestaurantContext.Provider>
  );
}

function SectionTabs({
  restaurantId,
  isOwner,
  roles,
}: {
  restaurantId: string;
  isOwner: boolean;
  roles: readonly RestaurantRole[];
}) {
  const pathname = usePathname();
  const base = `/admin/${restaurantId}`;
  // Tabs a member cannot use are hidden (the api would answer 403 anyway); direct URLs explain why.
  const tabs = [
    { href: base, label: "Resumen", icon: LayoutDashboardIcon, show: true },
    { href: `${base}/pedidos`, label: "Pedidos", icon: ClipboardListIcon, show: canWorkOrders(roles) },
    { href: `${base}/menu`, label: "Menú", icon: BookOpenIcon, show: isOwner },
    { href: `${base}/disponibilidad`, label: "Disponibilidad", icon: PackageCheckIcon, show: canManageAvailability(roles) },
    { href: `${base}/mesas`, label: "Mesas", icon: QrCodeIcon, show: isOwner },
    { href: `${base}/equipo`, label: "Equipo", icon: UsersIcon, show: isOwner },
  ].filter((tab) => tab.show);

  return (
    <nav aria-label="Secciones del restaurante" className="-mx-4 overflow-x-auto border-b px-4">
      <ul className="flex gap-1">
        {tabs.map(({ href, label, icon: Icon }) => {
          // Sections with sub-pages (Menú → Modificadores) stay highlighted inside them.
          const active = href === base ? pathname === base : pathname === href || pathname.startsWith(`${href}/`);
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

/** Whether customers can order right now (the switch lives on the Pedidos screen). */
function OpenBadge({ open }: { open: boolean }) {
  return (
    <Badge
      variant={open ? "secondary" : "outline"}
      className={open ? "bg-success/10 text-success" : "text-muted-foreground"}
      data-testid="open-badge"
    >
      <span className={cn("size-1.5 rounded-full", open ? "bg-success" : "bg-muted-foreground")} aria-hidden />
      {open ? "Recibiendo pedidos" : "Cerrado"}
    </Badge>
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
