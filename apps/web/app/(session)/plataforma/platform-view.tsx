"use client";

import type { PlatformRestaurantPage, PlatformRestaurantView, RestaurantStatus } from "@app/types";
import { ChevronLeftIcon, ChevronRightIcon, ExternalLinkIcon, SearchIcon, SearchXIcon, StoreIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { useAuth } from "@/lib/auth-context";
import { platformApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { pageCount } from "@/lib/platform";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 350;

/**
 * /plataforma: every restaurant on the platform, for users with platformRole "admin". Anyone else sees the
 * same "not found" the api answers (404), so the page does not reveal it exists.
 */
export function PlatformView() {
  const { user } = useAuth();
  if (user?.platformRole !== "admin") return <PageNotFound />;
  return <RestaurantsAdmin />;
}

function PageNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-12 text-center" role="alert">
      <SearchXIcon className="size-10 text-muted-foreground" aria-hidden />
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">No encontramos esta página</h1>
        <p className="text-sm text-muted-foreground">La dirección no existe o no tienes acceso.</p>
      </div>
      <Button asChild>
        <Link href="/admin">Ir a mis restaurantes</Link>
      </Button>
    </div>
  );
}

/** Value typed in the search box, applied after a pause (one request per pause, not per keystroke). */
function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function RestaurantsAdmin() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<RestaurantStatus | "">("");
  const query = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  // The page belongs to one search + filter: a new one starts at page 1 (without an extra request).
  const filterKey = `${query}|${status}`;
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const setPage = (next: number) => setPaging({ key: filterKey, page: next });
  const [target, setTarget] = useState<PlatformRestaurantView | null>(null);
  const [pending, setPending] = useState(false);
  const searchId = useId();
  const statusId = useId();

  const load = useCallback(
    () => platformApi.restaurants({ ...(query ? { q: query } : {}), ...(status ? { status } : {}), page }),
    [query, status, page],
  );
  const { data, error, loading, reload, setData } = useApiQuery<PlatformRestaurantPage>(load);
  const pages = data ? pageCount(data.total) : 1;

  async function changeStatus(restaurant: PlatformRestaurantView, next: RestaurantStatus) {
    setPending(true);
    try {
      await platformApi.setStatus(restaurant.id, next);
      setData((current) =>
        current && {
          ...current,
          // Under a status filter the restaurant no longer matches: drop it from this page.
          items: status && status !== next
            ? current.items.filter((item) => item.id !== restaurant.id)
            : current.items.map((item) => (item.id === restaurant.id ? { ...item, status: next } : item)),
          total: status && status !== next ? current.total - 1 : current.total,
        },
      );
      toast.success(next === "suspended" ? `Suspendiste ${restaurant.name}` : `Reactivaste ${restaurant.name}`);
      setTarget(null);
    } catch (failure) {
      toast.error(errorMessage(failure));
      setTarget(null);
      if (hasCode(failure, "RESTAURANT_NOT_FOUND")) reload();
    } finally {
      setPending(false);
    }
  }

  // The session lost the admin role meanwhile: same answer as for anyone else.
  if (hasCode(error, "NOT_FOUND")) return <PageNotFound />;

  const suspending = target?.status === "active";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Plataforma</h1>
        <p className="text-sm text-muted-foreground">Todos los restaurantes, los más nuevos primero.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={searchId} className="text-sm font-medium">
            Buscar
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id={searchId}
              type="search"
              value={search}
              maxLength={100}
              placeholder="Nombre o dirección del restaurante"
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:w-44">
          <label htmlFor={statusId} className="text-sm font-medium">
            Estado
          </label>
          <NativeSelect id={statusId} value={status} onChange={(event) => setStatus(event.target.value as RestaurantStatus | "")}>
            <option value="">Todos</option>
            <option value="active">Activos</option>
            <option value="suspended">Suspendidos</option>
          </NativeSelect>
        </div>
      </div>

      {error && !data ? (
        <div className="flex flex-col items-start gap-3">
          <FormError error={error} />
          <Button variant="outline" onClick={reload}>
            Reintentar
          </Button>
        </div>
      ) : !data ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando restaurantes">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-12 text-center" role="status">
          <StoreIcon className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-semibold">Sin resultados</p>
          <p className="text-sm text-muted-foreground">
            {query || status ? "Ningún restaurante coincide con la búsqueda." : "Todavía no hay restaurantes."}
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {data.total} {data.total === 1 ? "restaurante" : "restaurantes"}
          </p>
          <ul className={cn("flex flex-col gap-3 transition-opacity", loading && "opacity-60")} aria-busy={loading || undefined}>
            {data.items.map((restaurant) => (
              <RestaurantRow key={restaurant.id} restaurant={restaurant} onAction={() => setTarget(restaurant)} />
            ))}
          </ul>
          {pages > 1 ? (
            <nav aria-label="Páginas" className="flex items-center justify-between gap-3">
              <Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(Math.max(1, page - 1))}>
                <ChevronLeftIcon aria-hidden data-icon="inline-start" />
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Página {page} de {pages}
              </span>
              <Button variant="outline" disabled={page >= pages || loading} onClick={() => setPage(Math.min(pages, page + 1))}>
                Siguiente
                <ChevronRightIcon aria-hidden data-icon="inline-end" />
              </Button>
            </nav>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={target ? (suspending ? `¿Suspender ${target.name}?` : `¿Reactivar ${target.name}?`) : ""}
        description={
          suspending
            ? "Sale del menú público, no puede recibir pedidos y su equipo verá el panel en solo lectura. Puedes reactivarlo cuando quieras."
            : "Vuelve a aparecer en su menú público y su equipo puede volver a editarlo y recibir pedidos (si abren el local)."
        }
        confirmLabel={suspending ? "Suspender" : "Reactivar"}
        destructive={suspending}
        pending={pending}
        onConfirm={() => target && void changeStatus(target, suspending ? "suspended" : "active")}
      />
    </div>
  );
}

function RestaurantRow({ restaurant, onAction }: { restaurant: PlatformRestaurantView; onAction(): void }) {
  const suspended = restaurant.status === "suspended";
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:flex-row sm:items-start sm:justify-between" data-testid="platform-restaurant">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold break-words">{restaurant.name}</h2>
          {suspended ? <Badge variant="destructive">Suspendido</Badge> : <Badge variant="secondary">Activo</Badge>}
        </div>
        <a
          href={`/r/${restaurant.slug}`}
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 self-start rounded-sm font-mono text-sm break-all text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          /r/{restaurant.slug}
          <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">(se abre en una pestaña nueva)</span>
        </a>
        <ul className="flex flex-col text-sm" aria-label="Dueños">
          {restaurant.owners.map((owner) => (
            <li key={owner.email} className="break-words">
              {owner.name} <span className="text-muted-foreground">· {owner.email}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
          <div>
            <dt className="inline">Miembros: </dt>
            <dd className="inline tabular-nums">{restaurant.members}</dd>
          </div>
          <div>
            <dt className="inline">Creado: </dt>
            <dd className="inline">{formatDate(restaurant.createdAt)}</dd>
          </div>
        </dl>
      </div>
      <Button variant={suspended ? "outline" : "destructive"} className="self-start" onClick={onAction}>
        {suspended ? "Reactivar" : "Suspender"}
      </Button>
    </li>
  );
}
