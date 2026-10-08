"use client";

import { MENU_LIMITS, type MenuCategoryView, type ModifierGroupView, type ProductView } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { ImageField } from "@/components/image-field";
import { NativeSelect } from "@/components/native-select";
import { PriceInput } from "@/components/price-input";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { menuApi, type ProductInput } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { formatPriceInput, parsePriceInput } from "@/lib/money";
import { type ProductValues, productSchema } from "@/lib/validation";
import { ModifierGroupsPicker } from "./modifier-groups-picker";

const MIN_SIDE = MENU_LIMITS.imageMinSide;

export interface ProductSheetState {
  /**
   * Identifies one opening of the sheet. Kept when a new product is created, so the form is not
   * remounted (focus and typed values stay) while it switches to editing the created product.
   */
  key: number;
  /** null = new product. */
  product: ProductView | null;
  /** Category preselected for a new product. */
  categoryId: string;
}

interface ProductSheetProps {
  restaurantId: string;
  categories: readonly MenuCategoryView[];
  groups: readonly ModifierGroupView[];
  state: ProductSheetState | null;
  onClose(): void;
  /** Stores the saved product in the editor (created = it was just added). */
  onSaved(product: ProductView, created: boolean): void;
  onDeleted(productId: string): void;
  /** The menu changed under us (deleted category/group/product): reload it. */
  onStale(): void;
}

/** Side sheet (full width on phones) to create or edit a product, its photo and its modifier groups. */
export function ProductSheet({ state, onClose, ...props }: ProductSheetProps) {
  return (
    <Sheet open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-lg data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        {state ? <ProductForm key={state.key} state={state} onClose={onClose} {...props} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function initialValues({ product, categoryId }: ProductSheetState): ProductValues {
  return {
    categoryId: product?.categoryId ?? categoryId,
    name: product?.name ?? "",
    description: product?.description ?? "",
    price: product ? formatPriceInput(product.price) : "",
    visible: product?.visible ?? true,
    modifierGroupIds: product?.modifierGroupIds ?? [],
  };
}

function toInput(values: ProductValues): ProductInput {
  return { ...values, price: parsePriceInput(values.price) ?? 0 };
}

/** Only the fields that changed (PATCH is partial; unchanged group lists are not resent). */
function changedFields(product: ProductView, input: ProductInput): Partial<ProductInput> {
  const changes: Partial<ProductInput> = {};
  if (input.categoryId !== product.categoryId) changes.categoryId = input.categoryId;
  if (input.name !== product.name) changes.name = input.name;
  if (input.description !== product.description) changes.description = input.description;
  if (input.price !== product.price) changes.price = input.price;
  if (input.visible !== product.visible) changes.visible = input.visible;
  if (input.modifierGroupIds.join() !== product.modifierGroupIds.join()) changes.modifierGroupIds = input.modifierGroupIds;
  return changes;
}

function ProductForm({
  restaurantId,
  categories,
  groups,
  state,
  onClose,
  onSaved,
  onDeleted,
  onStale,
}: Omit<ProductSheetProps, "state"> & { state: ProductSheetState }) {
  const { product } = state;
  const form = useForm<ProductValues>({ resolver: zodResolver(productSchema), defaultValues: initialValues(state) });
  const { errors } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function onSubmit(values: ProductValues) {
    setError(null);
    const input = toInput(values);
    setSaving(true);
    try {
      if (!product) {
        const created = await menuApi.createProduct(restaurantId, input);
        // Stays open on the new product so the owner can add the photo right away.
        onSaved(created, true);
        toast.success("Producto creado. Ahora puedes agregarle una foto.");
        return;
      }
      const changes = changedFields(product, input);
      if (Object.keys(changes).length > 0) onSaved(await menuApi.updateProduct(restaurantId, product.id, changes), false);
      toast.success("Cambios guardados");
      onClose();
    } catch (failure) {
      handleError(failure);
    } finally {
      setSaving(false);
    }
  }

  function handleError(failure: unknown) {
    if (hasCode(failure, "INVALID_CATEGORY")) {
      form.setError("categoryId", { message: failure.message }, { shouldFocus: true });
      onStale();
    } else if (hasCode(failure, "INVALID_MODIFIER_GROUP")) {
      form.setError("modifierGroupIds", { message: failure.message });
      onStale();
    } else if (hasCode(failure, "PRODUCT_NOT_FOUND")) {
      toast.error(failure.message);
      onStale();
      onClose();
    } else {
      setError(failure);
    }
  }

  async function remove() {
    if (!product) return;
    setDeleting(true);
    try {
      await menuApi.deleteProduct(restaurantId, product.id);
      toast.success(`«${product.name}» eliminado`);
      setConfirmDelete(false);
      onDeleted(product.id);
      onClose();
    } catch (failure) {
      setConfirmDelete(false);
      setDeleting(false);
      handleError(failure);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" aria-label="Producto">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="text-lg">{product ? "Editar producto" : "Nuevo producto"}</SheetTitle>
        <SheetDescription>{product ? product.name : "Completa los datos y guarda. Después podrás subir la foto."}</SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <FormField id="product-category" label="Categoría" error={errors.categoryId?.message}>
          {(control) => (
            <NativeSelect {...control} {...form.register("categoryId")}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="product-name" label="Nombre" error={errors.name?.message}>
          {(control) => <Input {...control} autoComplete="off" placeholder="Ej. Barros Luco" {...form.register("name")} />}
        </FormField>
        <FormField id="product-description" label="Descripción (opcional)" error={errors.description?.message}>
          {(control) => (
            <Textarea {...control} rows={3} placeholder="Ej. Carne de vacuno y queso derretido en pan frica" {...form.register("description")} />
          )}
        </FormField>
        <FormField id="product-price" label="Precio" error={errors.price?.message} description="En pesos, sin decimales. Ej. 3.990">
          {(control) => <PriceInput {...control} placeholder="3.990" {...form.register("price")} />}
        </FormField>
        <Controller
          control={form.control}
          name="visible"
          render={({ field }) => (
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="product-visible">Visible en el menú</Label>
                <p id="product-visible-help" className="text-sm text-muted-foreground">
                  Apágalo para ocultarlo sin borrarlo.
                </p>
              </div>
              <Switch id="product-visible" aria-describedby="product-visible-help" checked={field.value} onCheckedChange={field.onChange} />
            </div>
          )}
        />
        <Controller
          control={form.control}
          name="modifierGroupIds"
          render={({ field, fieldState }) => (
            <ModifierGroupsPicker
              restaurantId={restaurantId}
              groups={groups}
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />

        <Separator />
        {product ? (
          <ImageField
            label="Foto"
            shape="photo"
            imageUrl={product.image?.md ?? null}
            description={`JPG, PNG, WebP o AVIF de hasta 8 MB y al menos ${MIN_SIDE}×${MIN_SIDE} px. Se recorta en formato 4:3.`}
            onUpload={async (file) => {
              onSaved(await menuApi.setProductImage(restaurantId, product.id, file), false);
              toast.success("Foto actualizada");
            }}
            onRemove={async () => {
              onSaved(await menuApi.removeProductImage(restaurantId, product.id), false);
              toast.success("Foto eliminada");
            }}
          />
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Foto</span>
            <p className="text-sm text-muted-foreground">Guarda el producto para poder subirle una foto.</p>
          </div>
        )}

        <FormError error={error} />

        {product ? (
          <div>
            <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2Icon aria-hidden data-icon="inline-start" />
              Eliminar producto
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex gap-2 border-t bg-muted/50 p-4">
        <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={onClose} disabled={saving}>
          {product ? "Cerrar" : "Cancelar"}
        </Button>
        <SubmitButton pending={saving} className="flex-1 sm:ml-auto sm:flex-none">
          {product ? "Guardar cambios" : "Crear producto"}
        </SubmitButton>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`¿Eliminar «${product?.name ?? ""}»?`}
        description="Se borrará del menú junto con su foto. No se puede deshacer."
        confirmLabel="Eliminar"
        destructive
        pending={deleting}
        onConfirm={() => void remove()}
      />
    </form>
  );
}
