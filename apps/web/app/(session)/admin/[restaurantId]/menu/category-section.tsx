"use client";

import type { MenuCategoryView, ProductView } from "@app/types";
import { EyeOffIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId } from "react";
import { ProductThumbnail } from "@/components/product-thumbnail";
import { ReorderButtons } from "@/components/reorder-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { formatPrice } from "@/lib/money";

interface CategorySectionProps {
  category: MenuCategoryView;
  products: ProductView[];
  index: number;
  count: number;
  currency: string;
  onMove(delta: -1 | 1): void;
  onEdit(): void;
  onDelete(): void;
  onAddProduct(): void;
  onEditProduct(product: ProductView): void;
  onMoveProduct(product: ProductView, delta: -1 | 1): void;
  onToggleAvailable(product: ProductView, available: boolean): void;
}

/** One category of the editor: header with its actions and the list of its products. */
export function CategorySection({
  category,
  products,
  index,
  count,
  currency,
  onMove,
  onEdit,
  onDelete,
  onAddProduct,
  onEditProduct,
  onMoveProduct,
  onToggleAvailable,
}: CategorySectionProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-xl bg-card ring-1 ring-foreground/10"
      data-testid="category-section"
    >
      <div className="flex flex-wrap items-start gap-2 border-b p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={headingId} className="text-base font-semibold break-words">
              {category.name}
            </h3>
            {category.active ? null : (
              <Badge variant="outline">
                <EyeOffIcon aria-hidden />
                Oculta
              </Badge>
            )}
          </div>
          {category.description ? <p className="text-sm text-muted-foreground">{category.description}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          <ReorderButtons itemName={`categoría ${category.name}`} index={index} count={count} onMove={onMove} />
          <Button type="button" variant="ghost" size="icon" aria-label={`Editar categoría ${category.name}`} onClick={onEdit}>
            <PencilIcon aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Eliminar categoría ${category.name}`} onClick={onDelete}>
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">Esta categoría aún no tiene productos.</p>
          <Button type="button" onClick={onAddProduct}>
            <PlusIcon aria-hidden data-icon="inline-start" />
            Agrega un producto
          </Button>
        </div>
      ) : (
        <>
          <ul className="flex flex-col divide-y" aria-label={`Productos de ${category.name}`}>
            {products.map((product, productIndex) => (
              <ProductRow
                key={product.id}
                product={product}
                index={productIndex}
                count={products.length}
                currency={currency}
                onEdit={() => onEditProduct(product)}
                onMove={(delta) => onMoveProduct(product, delta)}
                onToggleAvailable={(available) => onToggleAvailable(product, available)}
              />
            ))}
          </ul>
          <div className="border-t p-3">
            <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={onAddProduct}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              Agregar producto a {category.name}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function ProductRow({
  product,
  index,
  count,
  currency,
  onEdit,
  onMove,
  onToggleAvailable,
}: {
  product: ProductView;
  index: number;
  count: number;
  currency: string;
  onEdit(): void;
  onMove(delta: -1 | 1): void;
  onToggleAvailable(available: boolean): void;
}) {
  const switchId = useId();
  return (
    <li className="flex flex-col gap-2 px-4 py-3" data-testid="product-row">
      <div className="flex items-center gap-3">
        <ProductThumbnail image={product.image} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-medium">{product.name}</span>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="tabular-nums">{formatPrice(product.price, currency)}</span>
            {product.available ? null : <Badge variant="destructive">Agotado</Badge>}
            {product.visible ? null : <Badge variant="outline">Oculto</Badge>}
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onEdit} aria-label={`Editar ${product.name}`}>
          <PencilIcon aria-hidden data-icon="inline-start" />
          Editar
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Switch
            id={switchId}
            checked={product.available}
            onCheckedChange={onToggleAvailable}
            aria-label={`${product.name} disponible`}
          />
          <label htmlFor={switchId} className="text-sm text-muted-foreground" aria-hidden>
            {product.available ? "Disponible" : "Agotado"}
          </label>
        </div>
        <ReorderButtons itemName={product.name} index={index} count={count} onMove={onMove} />
      </div>
    </li>
  );
}
