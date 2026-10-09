"use client";

import type { AdminMenuView, MenuCategoryView, ProductView } from "@app/types";
import { BookOpenIcon, PlusIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSerialQueue } from "@/hooks/use-serial-queue";
import { menuApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { groupProductsByCategory, moveItem } from "@/lib/menu";
import { useRestaurant } from "../restaurant-context";
import { CategoryDialog } from "./category-dialog";
import { CategorySection } from "./category-section";
import { MenuNav } from "./menu-nav";
import { ProductSheet, type ProductSheetState } from "./product-sheet";

export function MenuEditor() {
  const { restaurant, isOwner } = useRestaurant();
  if (!isOwner) {
    return (
      <AccessDenied
        restaurantId={restaurant.id}
        description="Solo los dueños pueden editar el menú. Para marcar productos agotados usa Disponibilidad."
      />
    );
  }
  return <OwnerMenuEditor restaurantId={restaurant.id} slug={restaurant.slug} currency={restaurant.currency} />;
}

/** Replaces the products of one category with `ids` order, keeping every other product where it was. */
function withProductOrder(products: ProductView[], categoryId: string, ids: string[]): ProductView[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const reordered = ids.map((id) => byId.get(id)).filter((product): product is ProductView => product !== undefined);
  return [...products.filter((product) => product.categoryId !== categoryId), ...reordered];
}

function OwnerMenuEditor({ restaurantId, slug, currency }: { restaurantId: string; slug: string; currency: string }) {
  const { data, error, loading, reload, setData } = useApiQuery<AdminMenuView>(
    useCallback(() => menuApi.get(restaurantId), [restaurantId]),
  );
  const enqueue = useSerialQueue();
  const [categoryDialog, setCategoryDialog] = useState<{ category: MenuCategoryView | null } | null>(null);
  const [productSheet, setProductSheet] = useState<ProductSheetState | null>(null);
  const [deleting, setDeleting] = useState<MenuCategoryView | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const sheetKey = useRef(0);

  const grouped = useMemo(() => (data ? groupProductsByCategory(data.categories, data.products) : []), [data]);

  const update = useCallback(
    (change: (menu: AdminMenuView) => AdminMenuView) => setData((menu) => (menu ? change(menu) : menu)),
    [setData],
  );

  /** Shared failure path for optimistic changes: tell the owner and load the real state again. */
  const rollback = useCallback(
    (failure: unknown) => {
      toast.error(errorMessage(failure));
      reload();
    },
    [reload],
  );

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
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando menú">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  function openNewProduct(categoryId: string) {
    sheetKey.current += 1;
    setProductSheet({ key: sheetKey.current, product: null, categoryId });
  }

  function openProduct(product: ProductView) {
    sheetKey.current += 1;
    setProductSheet({ key: sheetKey.current, product, categoryId: product.categoryId });
  }

  function moveCategory(index: number, delta: -1 | 1) {
    if (!data) return;
    const categories = moveItem(data.categories, index, index + delta);
    const moved = categories[index + delta] as MenuCategoryView;
    update((menu) => ({ ...menu, categories }));
    setAnnouncement(`${moved.name}: posición ${index + delta + 1} de ${categories.length}`);
    const ids = categories.map((category) => category.id);
    enqueue(() => menuApi.reorderCategories(restaurantId, ids)).catch(rollback);
  }

  function moveProduct(product: ProductView, delta: -1 | 1) {
    if (!data) return;
    const siblings = data.products.filter((other) => other.categoryId === product.categoryId);
    const index = siblings.findIndex((other) => other.id === product.id);
    const ids = moveItem(siblings, index, index + delta).map((other) => other.id);
    update((menu) => ({ ...menu, products: withProductOrder(menu.products, product.categoryId, ids) }));
    setAnnouncement(`${product.name}: posición ${index + delta + 1} de ${siblings.length}`);
    enqueue(() => menuApi.reorderProducts(restaurantId, product.categoryId, ids)).catch(rollback);
  }

  function toggleAvailable(product: ProductView, available: boolean) {
    const set = (value: boolean) =>
      update((menu) => ({
        ...menu,
        products: menu.products.map((other) => (other.id === product.id ? { ...other, available: value } : other)),
      }));
    set(available);
    // The switch itself is the feedback; only failures are announced.
    menuApi.setProductAvailability(restaurantId, product.id, available).catch((failure: unknown) => {
      set(!available);
      toast.error(errorMessage(failure));
    });
  }

  function saveProduct(saved: ProductView, created: boolean) {
    update((menu) => {
      const existing = menu.products.find((product) => product.id === saved.id);
      // A product moved to another category goes to its end (same as the api).
      const products =
        existing && existing.categoryId === saved.categoryId
          ? menu.products.map((product) => (product.id === saved.id ? saved : product))
          : [...menu.products.filter((product) => product.id !== saved.id), saved];
      return { ...menu, products };
    });
    if (created) setProductSheet((state) => (state ? { ...state, product: saved } : state));
    else setProductSheet((state) => (state?.product?.id === saved.id ? { ...state, product: saved } : state));
  }

  function saveCategory(saved: MenuCategoryView, created: boolean) {
    update((menu) => ({
      ...menu,
      categories: created
        ? [...menu.categories, saved]
        : menu.categories.map((category) => (category.id === saved.id ? saved : category)),
    }));
  }

  function askDeleteCategory(category: MenuCategoryView, productCount: number) {
    if (productCount > 0) {
      toast.info(
        `«${category.name}» tiene ${productCount === 1 ? "1 producto" : `${productCount} productos`}. Muévelos a otra categoría o elimínalos antes de borrarla.`,
      );
      return;
    }
    setDeleting(category);
  }

  async function deleteCategory() {
    if (!deleting) return;
    setDeletePending(true);
    try {
      await menuApi.deleteCategory(restaurantId, deleting.id);
      update((menu) => ({ ...menu, categories: menu.categories.filter((category) => category.id !== deleting.id) }));
      toast.success(`Categoría «${deleting.name}» eliminada`);
    } catch (failure) {
      toast.error(errorMessage(failure));
      // CATEGORY_NOT_EMPTY: someone added a product meanwhile; NOT_FOUND: already gone.
      if (hasCode(failure, "CATEGORY_NOT_EMPTY", "CATEGORY_NOT_FOUND")) reload();
    } finally {
      setDeletePending(false);
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <MenuNav restaurantId={restaurantId} slug={slug} current="products" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">Categorías y productos</h2>
          <p className="text-sm text-muted-foreground">Ordénalos como quieres que aparezcan en tu menú.</p>
        </div>
        {data.categories.length > 0 ? (
          <Button onClick={() => setCategoryDialog({ category: null })}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            Nueva categoría
          </Button>
        ) : null}
      </div>

      {data.categories.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand-soft-foreground" aria-hidden>
            <BookOpenIcon className="size-7" />
          </span>
          <div className="flex max-w-sm flex-col gap-1">
            <h3 className="text-lg font-semibold">Tu menú está vacío</h3>
            <p className="text-sm text-muted-foreground">
              Crea tu primera categoría (ej. Sándwiches) y después agrégale productos con su precio y foto.
            </p>
          </div>
          <Button size="lg" onClick={() => setCategoryDialog({ category: null })}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            Crear categoría
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(({ category, products }, index) => (
            <CategorySection
              key={category.id}
              category={category}
              products={products}
              index={index}
              count={grouped.length}
              currency={currency}
              onMove={(delta) => moveCategory(index, delta)}
              onEdit={() => setCategoryDialog({ category })}
              onDelete={() => askDeleteCategory(category, products.length)}
              onAddProduct={() => openNewProduct(category.id)}
              onEditProduct={openProduct}
              onMoveProduct={moveProduct}
              onToggleAvailable={toggleAvailable}
            />
          ))}
        </div>
      )}

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <CategoryDialog
        restaurantId={restaurantId}
        category={categoryDialog?.category ?? null}
        categories={data.categories}
        open={categoryDialog !== null}
        onOpenChange={(open) => !open && setCategoryDialog(null)}
        onSaved={saveCategory}
        onStale={reload}
      />
      <ProductSheet
        restaurantId={restaurantId}
        categories={data.categories}
        products={data.products}
        groups={data.modifierGroups}
        state={productSheet}
        onClose={() => setProductSheet(null)}
        onSaved={saveProduct}
        onDeleted={(productId) =>
          update((menu) => ({ ...menu, products: menu.products.filter((product) => product.id !== productId) }))
        }
        onStale={reload}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`¿Eliminar la categoría «${deleting?.name ?? ""}»?`}
        description="Está vacía, así que no se pierde ningún producto."
        confirmLabel="Eliminar"
        destructive
        pending={deletePending}
        onConfirm={() => void deleteCategory()}
      />
    </div>
  );
}
