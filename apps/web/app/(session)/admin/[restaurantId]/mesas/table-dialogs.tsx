"use client";

import type { TableView } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { tablesApi } from "@/lib/endpoints";
import { errorMessage } from "@/lib/errors";
import { bulkLabels, newLabels, TABLE_LABEL_MAX } from "@/lib/tables";
import { type BulkTablesValues, bulkTablesSchema, type TableValues, tableSchema } from "@/lib/validation";

/** Rename a table. */
export function RenameTableDialog({
  restaurantId,
  table,
  onOpenChange,
  onSaved,
}: {
  restaurantId: string;
  /** null = closed. */
  table: TableView | null;
  onOpenChange(open: boolean): void;
  onSaved(table: TableView): void;
}) {
  return (
    <Dialog open={table !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {table ? (
          <RenameForm key={table.id} restaurantId={restaurantId} table={table} onClose={() => onOpenChange(false)} onSaved={onSaved} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  restaurantId,
  table,
  onClose,
  onSaved,
}: {
  restaurantId: string;
  table: TableView;
  onClose(): void;
  onSaved(table: TableView): void;
}) {
  const form = useForm<TableValues>({ resolver: zodResolver(tableSchema), defaultValues: { label: table.label } });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function submit(values: TableValues) {
    if (values.label === table.label) return onClose();
    setSaving(true);
    setError(null);
    try {
      onSaved(await tablesApi.update(restaurantId, table.id, { label: values.label }));
      onClose();
    } catch (failure) {
      setSaving(false);
      setError(failure);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Renombrar mesa</DialogTitle>
        <DialogDescription>El código QR no cambia: los impresos siguen funcionando.</DialogDescription>
      </DialogHeader>
      <FormField id="table-rename" label="Nombre" error={form.formState.errors.label?.message}>
        {(control) => <Input {...control} autoComplete="off" maxLength={TABLE_LABEL_MAX} {...form.register("label")} />}
      </FormField>
      <FormError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <SubmitButton pending={saving}>Guardar</SubmitButton>
      </DialogFooter>
    </form>
  );
}

/** "Agregar varias": prefix + range, created one by one (labels already in use are skipped). */
export function BulkTablesDialog({
  restaurantId,
  open,
  existing,
  onOpenChange,
  onCreated,
}: {
  restaurantId: string;
  open: boolean;
  existing: readonly string[];
  onOpenChange(open: boolean): void;
  onCreated(table: TableView): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? (
          <BulkForm restaurantId={restaurantId} existing={existing} onClose={() => onOpenChange(false)} onCreated={onCreated} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BulkForm({
  restaurantId,
  existing,
  onClose,
  onCreated,
}: {
  restaurantId: string;
  existing: readonly string[];
  onClose(): void;
  onCreated(table: TableView): void;
}) {
  const form = useForm<BulkTablesValues>({
    resolver: zodResolver(bulkTablesSchema),
    defaultValues: { prefix: "Mesa", from: 1, to: 10 },
  });
  const { errors } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const values = form.watch();
  const preview = bulkLabels(values.prefix ?? "", Number(values.from), Number(values.to));
  const toCreate = preview.ok ? newLabels(preview.labels, existing) : [];

  async function submit(input: BulkTablesValues) {
    const result = bulkLabels(input.prefix, input.from, input.to);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    const labels = newLabels(result.labels, existing);
    if (labels.length === 0) {
      setMessage("Esas mesas ya existen.");
      return;
    }
    setError(null);
    setMessage(null);
    setProgress({ done: 0, total: labels.length });
    // One at a time, in order: the list keeps a natural order and a failure stops cleanly.
    for (const [index, label] of labels.entries()) {
      try {
        onCreated(await tablesApi.create(restaurantId, label));
        setProgress({ done: index + 1, total: labels.length });
      } catch (failure) {
        setProgress(null);
        setError(failure);
        if (index > 0) setMessage(`${errorMessage(failure)} Se crearon ${index} de ${labels.length} mesas antes del error.`);
        return;
      }
    }
    onClose();
  }

  const working = progress !== null;
  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Agregar varias mesas</DialogTitle>
        <DialogDescription>Crea una serie numerada, por ejemplo Mesa 1 a Mesa 10.</DialogDescription>
      </DialogHeader>
      <FormField id="bulk-prefix" label="Nombre" error={errors.prefix?.message}>
        {(control) => <Input {...control} autoComplete="off" {...form.register("prefix")} />}
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField id="bulk-from" label="Desde" error={errors.from?.message}>
          {(control) => <Input {...control} type="number" inputMode="numeric" min={0} {...form.register("from", { valueAsNumber: true })} />}
        </FormField>
        <FormField id="bulk-to" label="Hasta" error={errors.to?.message}>
          {(control) => <Input {...control} type="number" inputMode="numeric" min={0} {...form.register("to", { valueAsNumber: true })} />}
        </FormField>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {preview.ok
          ? toCreate.length === 0
            ? "Todas esas mesas ya existen."
            : `Se crearán ${toCreate.length}: ${toCreate[0]}${toCreate.length > 1 ? ` … ${toCreate[toCreate.length - 1]}` : ""}`
          : null}
        {preview.ok && toCreate.length < preview.labels.length && toCreate.length > 0
          ? ` (${preview.labels.length - toCreate.length} ya existen)`
          : null}
      </p>
      <FormError error={error} message={message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={working}>
          Cancelar
        </Button>
        <SubmitButton pending={working} disabled={toCreate.length === 0}>
          {progress ? `Creando ${progress.done} de ${progress.total}…` : "Crear mesas"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
