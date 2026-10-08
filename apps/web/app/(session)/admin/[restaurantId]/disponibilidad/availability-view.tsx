"use client";

import type { AdminMenuView, ModifierGroupView, ProductView } from "@app/types";
import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import { FormError } from "@/components/form-error";
import { ProductThumbnail } from "@/components/product-thumbnail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useApiQuery } from "@/hooks/use-api-query";
import { menuApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { canManageAvailability, groupProductsByCategory, modifierRuleSummary } from "@/lib/menu";
import { cn } from "@/lib/utils";
import { useRestaurant } from "../restaurant-context";

export function AvailabilityView() {
  const { restaurant, isOwner, reload } = useRestaurant();
  if (!canManageAvailability(restaurant.myRoles)) {
    return (
      <AccessDenied
        restaurantId={restaurant.id}
        title="Sin acceso"
        description="Solo dueños, caja y cocina pueden marcar productos agotados."
      />
    );
  }
  return <Availability restaurantId={restaurant.id} isOwner={isOwner} onForbidden={reload} />;
}

/** Case- and accent-insensitive text for the search box ("sandwich" finds "Sándwich"). */
function searchable(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function Availability({ restaurantId, isOwner, onForbidden }: { restaurantId: string; isOwner: boolean; onForbidden(): void }) {
  const { data, error, loading, reload, setData } = useApiQuery<AdminMenuView>(
    useCallback(() => menuApi.get(restaurantId), [restaurantId]),
  );
  const [query, setQuery] = useState("");
  const searchId = useId();
  const term = searchable(query.trim());

  const sections = useMemo(() => {
    if (!data) return [];
    return groupProductsByCategory(data.categories, data.products)
      .map(({ category, products }) => ({
        category,
        products: term ? products.filter((product) => searchable(product.name).includes(term)) : products,
      }))
      .filter((section) => section.products.length > 0);
  }, [data, term]);

  const groups = useMemo(
    () =>
      (data?.modifierGroups ?? [])
        .map((group) => ({
          group,
          options: term
            ? group.options.filter((option) => searchable(`${group.name} ${option.name}`).includes(term))
            : group.options,
        }))
        .filter((entry) => entry.options.length > 0),
    [data, term],
  );

  function handleFailure(failure: unknown) {
    toast.error(errorMessage(failure));
    // Lost the role meanwhile: the shell reloads and shows "Sin acceso".
    if (hasCode(failure, "FORBIDDEN_ROLE")) onForbidden();
    else if (hasCode(failure, "PRODUCT_NOT_FOUND", "MODIFIER_GROUP_NOT_FOUND", "MODIFIER_OPTION_NOT_FOUND")) reload();
  }

  function setProduct(product: ProductView, available: boolean) {
    const apply = (value: boolean) =>
      setData((menu) =>
        menu && { ...menu, products: menu.products.map((p) => (p.id === product.id ? { ...p, available: value } : p)) },
      );
    apply(available);
    menuApi.setProductAvailability(restaurantId, product.id, available).catch((failure: unknown) => {
      apply(!available);
      handleFailure(failure);
    });
  }

  function setOption(group: ModifierGroupView, optionId: string, available: boolean) {
    const apply = (value: boolean) =>
      setData(
        (menu) =>
          menu && {
            ...menu,
            modifierGroups: menu.modifierGroups.map((g) =>
              g.id === group.id
                ? { ...g, options: g.options.map((o) => (o.id === optionId ? { ...o, available: value } : o)) }
                : g,
            ),
          },
      );
    apply(available);
    menuApi.setOptionAvailability(restaurantId, group.id, optionId, available).catch((failure: unknown) => {
      apply(!available);
      handleFailure(failure);
    });
  }

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
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando productos">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const empty = data.products.length === 0 && data.modifierGroups.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold">Disponibilidad</h2>
        <p className="text-sm text-muted-foreground">
          Marca como agotado lo que se acabó. Tus clientes lo verán al instante, pero no podrán pedirlo.
        </p>
      </div>

      {empty ? (
        <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Todavía no hay productos en el menú.
          {isOwner ? (
            <>
              {" "}
              <Link href={`/admin/${restaurantId}/menu`} className="font-medium text-primary underline-offset-4 hover:underline">
                Arma tu menú
              </Link>
              .
            </>
          ) : null}
        </div>
      ) : (
        <>
          <div className="relative">
            <label htmlFor={searchId} className="sr-only">
              Buscar producto u opción
            </label>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id={searchId}
              type="search"
              placeholder="Buscar producto u opción"
              className="h-11 pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {sections.length === 0 && groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground" role="status">
              Nada coincide con «{query}».
            </p>
          ) : null}

          {sections.map(({ category, products }) => (
            <section key={category.id} aria-labelledby={`availability-${category.id}`} className="flex flex-col gap-2">
              <h3 id={`availability-${category.id}`} className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                {category.name}
              </h3>
              <ul className="flex flex-col divide-y rounded-xl bg-card ring-1 ring-foreground/10">
                {products.map((product) => (
                  <AvailabilityRow
                    key={product.id}
                    name={product.name}
                    available={product.available}
                    onChange={(available) => setProduct(product, available)}
                    leading={<ProductThumbnail image={product.image} className="w-12" />}
                  />
                ))}
              </ul>
            </section>
          ))}

          {groups.length > 0 ? (
            <section aria-labelledby="availability-options" className="flex flex-col gap-3">
              <h3 id="availability-options" className="text-base font-semibold">
                Opciones
              </h3>
              {groups.map(({ group, options }) => (
                <div key={group.id} className="flex flex-col gap-2">
                  <h4 className="text-sm font-semibold tracking-wide text-muted-foreground">
                    <span className="uppercase">{group.name}</span>
                    <span className="font-normal normal-case"> · {modifierRuleSummary(group.minSelect, group.maxSelect)}</span>
                  </h4>
                  <ul className="flex flex-col divide-y rounded-xl bg-card ring-1 ring-foreground/10">
                    {options.map((option) => (
                      <AvailabilityRow
                        key={option.id}
                        name={option.name}
                        context={group.name}
                        available={option.available}
                        onChange={(available) => setOption(group, option.id, available)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Large tap target: the whole row toggles the switch. */
function AvailabilityRow({
  name,
  context,
  available,
  onChange,
  leading,
}: {
  name: string;
  /** Group name for options, so screen readers hear "Grande (Tamaño)". */
  context?: string;
  available: boolean;
  onChange(available: boolean): void;
  leading?: React.ReactNode;
}) {
  const id = useId();
  return (
    <li data-testid="availability-row">
      <label htmlFor={id} className="flex min-h-16 cursor-pointer items-center gap-3 px-4 py-2">
        {leading}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("font-medium break-words", !available && "text-muted-foreground line-through")}>{name}</span>
          <span className={cn("text-sm font-medium", available ? "text-success" : "text-destructive")} aria-hidden>
            {available ? "Disponible" : "Agotado"}
          </span>
        </span>
        <Switch
          id={id}
          size="lg"
          checked={available}
          onCheckedChange={onChange}
          aria-label={context ? `${name} (${context}) disponible` : `${name} disponible`}
        />
      </label>
    </li>
  );
}
