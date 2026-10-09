"use client";

import type { MenuCategoryView } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { menuApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { nameTakenFromError, nameTakenMessage } from "@/lib/unique-names";
import { type CategoryValues, categorySchema } from "@/lib/validation";

interface CategoryDialogProps {
  restaurantId: string;
  /** null = create a new category. */
  category: MenuCategoryView | null;
  /** Categories already loaded by the editor, to catch a repeated name before sending it. */
  categories: readonly MenuCategoryView[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(category: MenuCategoryView, created: boolean): void;
  /** The category vanished meanwhile (another owner deleted it). */
  onStale(): void;
}

/** Create or edit a category: name, description and whether it shows in the public menu. */
export function CategoryDialog({ open, onOpenChange, ...props }: CategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remounted on every open, so the form starts from the current values. */}
        {open ? <CategoryForm {...props} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  restaurantId,
  category,
  categories,
  onSaved,
  onStale,
  onClose,
}: Omit<CategoryDialogProps, "open" | "onOpenChange"> & { onClose(): void }) {
  const form = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: category?.name ?? "",
      description: category?.description ?? "",
      active: category?.active ?? true,
    },
  });
  const { errors } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(values: CategoryValues) {
    setError(null);
    // Same rule as the api, which only checks the name when it is sent (it changed).
    const taken = values.name !== category?.name ? nameTakenMessage("category", values.name, categories, category?.id) : null;
    if (taken) {
      form.setError("name", { message: taken }, { shouldFocus: true });
      return;
    }
    setSaving(true);
    try {
      if (category) {
        const changes = {
          ...(values.name !== category.name ? { name: values.name } : {}),
          ...(values.description !== category.description ? { description: values.description } : {}),
          ...(values.active !== category.active ? { active: values.active } : {}),
        };
        const saved = Object.keys(changes).length ? await menuApi.updateCategory(restaurantId, category.id, changes) : category;
        onSaved(saved, false);
        toast.success("Categoría actualizada");
      } else {
        const created = await menuApi.createCategory(restaurantId, { name: values.name, description: values.description });
        // New categories are visible; hiding one right away needs a second call.
        const saved = values.active ? created : await menuApi.updateCategory(restaurantId, created.id, { active: false });
        onSaved(saved, true);
        toast.success(`Categoría «${saved.name}» creada`);
      }
      onClose();
    } catch (failure) {
      setSaving(false);
      if (hasCode(failure, "CATEGORY_NOT_FOUND")) {
        toast.error(failure.message);
        onStale();
        onClose();
        return;
      }
      // Created from another tab meanwhile: the api's message, on the field.
      const taken = nameTakenFromError("category", failure);
      if (taken) form.setError("name", { message: taken }, { shouldFocus: true });
      else setError(failure);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{category ? "Editar categoría" : "Nueva categoría"}</DialogTitle>
        <DialogDescription>Agrupa productos parecidos, ej. Sándwiches, Bebidas o Postres.</DialogDescription>
      </DialogHeader>
      <FormField id="category-name" label="Nombre" error={errors.name?.message}>
        {(control) => <Input {...control} autoComplete="off" placeholder="Ej. Sándwiches" {...form.register("name")} />}
      </FormField>
      <FormField
        id="category-description"
        label="Descripción (opcional)"
        error={errors.description?.message}
      >
        {(control) => <Textarea {...control} rows={2} {...form.register("description")} />}
      </FormField>
      <Controller
        control={form.control}
        name="active"
        render={({ field }) => (
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="category-active">Visible en el menú</Label>
              <p id="category-active-help" className="text-sm text-muted-foreground">
                Si la ocultas, sus productos no aparecen en el menú público.
              </p>
            </div>
            <Switch
              id="category-active"
              aria-describedby="category-active-help"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          </div>
        )}
      />
      <FormError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <SubmitButton pending={saving}>{category ? "Guardar" : "Crear categoría"}</SubmitButton>
      </DialogFooter>
    </form>
  );
}
