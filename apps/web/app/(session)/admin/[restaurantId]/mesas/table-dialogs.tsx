"use client";

import type { TableView } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { tablesApi } from "@/lib/endpoints";
import { errorMessage } from "@/lib/errors";
import { bulkLabels, createInOrder, namedTables, TABLE_LABEL_MAX } from "@/lib/tables";
import { listPreview, nameTakenFromError, nameTakenMessage, planBulkTables } from "@/lib/unique-names";
import { type BulkTablesValues, bulkTablesSchema, type TableValues, tableSchema } from "@/lib/validation";

/** Rename a table. */
export function RenameTableDialog({
  restaurantId,
  table,
  tables,
  onOpenChange,
  onSaved,
}: {
  restaurantId: string;
  /** null = closed. */
  table: TableView | null;
  /** Tables already listed, to catch a repeated name before sending it. */
  tables: readonly TableView[];
  onOpenChange(open: boolean): void;
  onSaved(table: TableView): void;
}) {
  return (
    <Dialog open={table !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {table ? (
          <RenameForm
            key={table.id}
            restaurantId={restaurantId}
            table={table}
            tables={tables}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  restaurantId,
  table,
  tables,
  onClose,
  onSaved,
}: {
  restaurantId: string;
  table: TableView;
  tables: readonly TableView[];
  onClose(): void;
  onSaved(table: TableView): void;
}) {
  const form = useForm<TableValues>({ resolver: zodResolver(tableSchema), defaultValues: { label: table.label } });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function submit(values: TableValues) {
    if (values.label === table.label) return onClose();
    const taken = nameTakenMessage("table", values.label, namedTables(tables), table.id);
    if (taken) {
      form.setError("label", { message: taken }, { shouldFocus: true });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await tablesApi.update(restaurantId, table.id, { label: values.label }));
      onClose();
    } catch (failure) {
      setSaving(false);
      // Taken from another tab meanwhile: the api's message, on the field.
      const takenByApi = nameTakenFromError("table", failure);
      if (takenByApi) form.setError("label", { message: takenByApi }, { shouldFocus: true });
      else setError(failure);
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

/**
 * "Agregar varias": prefix + range, created one by one. Labels already in use (or repeated in the range) are
 * listed before creating and never sent; the button then says it creates only the new ones.
 */
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
  const plan = preview.ok ? planBulkTables(preview.labels, existing) : { create: [], skipped: [] };

  async function submit(input: BulkTablesValues) {
    const result = bulkLabels(input.prefix, input.from, input.to);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    const { create, skipped } = planBulkTables(result.labels, existing);
    if (create.length === 0) {
      setMessage("Esas mesas ya existen.");
      return;
    }
    setError(null);
    setMessage(null);
    setProgress({ done: 0, total: create.length });
    const outcome = await createInOrder(
      create,
      (label) => tablesApi.create(restaurantId, label),
      // Created from another tab meanwhile: skipped, the rest go on.
      (failure) => nameTakenFromError("table", failure) !== null,
      onCreated,
      (done) => setProgress({ done, total: create.length }),
    );
    if (outcome.error) {
      setProgress(null);
      setError(outcome.error);
      if (outcome.created.length > 0) {
        setMessage(`${errorMessage(outcome.error)} Se crearon ${outcome.created.length} de ${create.length} mesas antes del error.`);
      }
      return;
    }
    const omitted = skipped.length + outcome.taken.length;
    if (outcome.created.length === 0) {
      toast.info("No se creó ninguna mesa: todas ya existían.");
    } else {
      const created = outcome.created.length === 1 ? "Se creó 1 mesa" : `Se crearon ${outcome.created.length} mesas`;
      const skippedText =
        omitted === 0 ? "" : omitted === 1 ? "; se omitió 1 que ya existía" : `; se omitieron ${omitted} que ya existían`;
      toast.success(`${created}${skippedText}.`);
    }
    onClose();
  }

  const working = progress !== null;
  const someTaken = preview.ok && plan.skipped.length > 0 && plan.create.length > 0;
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
      <div aria-live="polite" className="flex flex-col gap-2 text-sm">
        {preview.ok ? (
          <p className="text-muted-foreground">
            {plan.create.length === 0
              ? "Todas esas mesas ya existen."
              : `Se crearán ${plan.create.length}: ${plan.create[0]}${plan.create.length > 1 ? ` … ${plan.create[plan.create.length - 1]}` : ""}`}
          </p>
        ) : null}
        {/* Shown before creating; the button below then creates only the new ones (that click confirms). */}
        {someTaken ? (
          <p className="rounded-lg bg-warning px-3 py-2 text-warning-foreground" data-testid="bulk-skipped">
            {plan.skipped.length === 1 ? "Ya existe" : `Ya existen ${plan.skipped.length}`}: {listPreview(plan.skipped)}. No se
            crearán de nuevo.
          </p>
        ) : null}
      </div>
      <FormError error={error} message={message} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={working}>
          Cancelar
        </Button>
        <SubmitButton pending={working} disabled={plan.create.length === 0}>
          {progress
            ? `Creando ${progress.done} de ${progress.total}…`
            : someTaken
              ? plan.create.length === 1
                ? "Crear solo la nueva"
                : `Crear solo las ${plan.create.length} nuevas`
              : "Crear mesas"}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
