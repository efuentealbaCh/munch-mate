"use client";

import type { MenuCategoryView } from "@app/types";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { categoriesToSave } from "@/lib/printers";

/**
 * Which menu categories a printer prints on kitchen tickets ("Todas", or some: the bar printer only drinks).
 * Saved with the button (one request for the whole selection).
 */
export function CategoriesDialog({
  open,
  printerName,
  categories,
  selected,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  printerName: string;
  categories: MenuCategoryView[];
  /** [] = every category. */
  selected: string[];
  onOpenChange(open: boolean): void;
  onSave(categoryIds: string[]): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <CategoriesForm
            printerName={printerName}
            categories={categories}
            selected={selected}
            onCancel={() => onOpenChange(false)}
            onSave={onSave}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CategoriesForm({
  printerName,
  categories,
  selected,
  onCancel,
  onSave,
}: {
  printerName: string;
  categories: MenuCategoryView[];
  selected: string[];
  onCancel(): void;
  onSave(categoryIds: string[]): void;
}) {
  const id = useId();
  const [all, setAll] = useState(selected.length === 0);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(selected));
  const ids = all ? [] : categoriesToSave(chosen, categories);
  // Some categories but none ticked would print nothing: not offered.
  const empty = !all && chosen.size === 0;

  function toggle(categoryId: string, checked: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (checked) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty) onSave(ids);
      }}
    >
      <DialogHeader>
        <DialogTitle>Categorías de «{printerName}»</DialogTitle>
        <DialogDescription>
          La comanda de esta impresora lleva solo los productos de estas categorías. Si un pedido no tiene ninguno, no imprime.
        </DialogDescription>
      </DialogHeader>
      <label htmlFor={`${id}-all`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm font-medium">
        <Checkbox id={`${id}-all`} checked={all} onCheckedChange={(checked) => setAll(checked === true)} />
        Todas (también las que agregues después)
      </label>
      {all ? null : (
        <fieldset className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          <legend className="sr-only">Categorías</legend>
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">El menú todavía no tiene categorías.</p>
          ) : (
            categories.map((category) => (
              <label
                key={category.id}
                htmlFor={`${id}-${category.id}`}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm hover:bg-muted"
              >
                <Checkbox
                  id={`${id}-${category.id}`}
                  checked={chosen.has(category.id)}
                  onCheckedChange={(checked) => toggle(category.id, checked === true)}
                />
                {category.name}
                {category.active ? null : <span className="text-xs text-muted-foreground">(oculta)</span>}
              </label>
            ))
          )}
        </fieldset>
      )}
      {empty ? (
        <p className="text-sm text-destructive" role="alert">
          Elige al menos una categoría, o marca «Todas».
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={empty}>
          Guardar
        </Button>
      </DialogFooter>
    </form>
  );
}
