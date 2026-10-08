"use client";

import { MENU_LIMITS, type ModifierGroupView } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { PriceInput } from "@/components/price-input";
import { ReorderButtons } from "@/components/reorder-buttons";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { type ModifierGroupInput, menuApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { modifierRuleSummary } from "@/lib/menu";
import { formatPriceInput, parsePriceInput } from "@/lib/money";
import { type ModifierGroupValues, modifierGroupSchema } from "@/lib/validation";

interface ModifierGroupSheetProps {
  restaurantId: string;
  /** undefined = closed; null = new group. */
  group: ModifierGroupView | null | undefined;
  onClose(): void;
  onSaved(group: ModifierGroupView, created: boolean): void;
  onStale(): void;
}

/** Create or edit a modifier group: name, selection rules and its options (with extra price). */
export function ModifierGroupSheet({ group, onClose, ...props }: ModifierGroupSheetProps) {
  return (
    <Sheet open={group !== undefined} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        {group !== undefined ? <GroupForm key={group?.id ?? "new"} group={group} onClose={onClose} {...props} /> : null}
      </SheetContent>
    </Sheet>
  );
}

const EMPTY_OPTION = { name: "", priceDelta: "0", available: true };

function initialValues(group: ModifierGroupView | null): ModifierGroupValues {
  if (!group) return { name: "", minSelect: 1, maxSelect: 1, options: [{ ...EMPTY_OPTION }, { ...EMPTY_OPTION }] };
  return {
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    options: group.options.map((option) => ({
      optionId: option.id,
      name: option.name,
      priceDelta: formatPriceInput(option.priceDelta),
      available: option.available,
    })),
  };
}

function toInput(values: ModifierGroupValues): ModifierGroupInput {
  return {
    name: values.name,
    minSelect: values.minSelect,
    maxSelect: values.maxSelect,
    options: values.options.map((option) => ({
      ...(option.optionId ? { id: option.optionId } : {}),
      name: option.name,
      priceDelta: parsePriceInput(option.priceDelta) ?? 0,
      available: option.available,
    })),
  };
}

function GroupForm({ restaurantId, group, onClose, onSaved, onStale }: Omit<ModifierGroupSheetProps, "group"> & { group: ModifierGroupView | null }) {
  const form = useForm<ModifierGroupValues>({ resolver: zodResolver(modifierGroupSchema), defaultValues: initialValues(group) });
  const { errors } = form.formState;
  const options = useFieldArray({ control: form.control, name: "options" });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [minSelect, maxSelect] = form.watch(["minSelect", "maxSelect"]);
  const rulesKnown = Number.isInteger(minSelect) && Number.isInteger(maxSelect);
  const optionsError = errors.options?.root?.message ?? errors.options?.message;

  async function onSubmit(values: ModifierGroupValues) {
    setError(null);
    setSaving(true);
    try {
      const input = toInput(values);
      const saved = group
        ? await menuApi.replaceModifierGroup(restaurantId, group.id, input)
        : await menuApi.createModifierGroup(restaurantId, input);
      onSaved(saved, group === null);
      toast.success(group ? "Grupo actualizado" : `Grupo «${saved.name}» creado`);
      onClose();
    } catch (failure) {
      setSaving(false);
      if (hasCode(failure, "INVALID_MODIFIER_RULES")) {
        form.setError("maxSelect", { message: failure.message }, { shouldFocus: true });
      } else if (hasCode(failure, "MODIFIER_GROUP_NOT_FOUND")) {
        toast.error(failure.message);
        onStale();
        onClose();
      } else {
        setError(failure);
      }
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" aria-label="Grupo de opciones">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="text-lg">{group ? "Editar grupo" : "Nuevo grupo de opciones"}</SheetTitle>
        <SheetDescription>
          {group && group.usedByProducts > 0
            ? `Los cambios se aplican a los ${group.usedByProducts === 1 ? "1 producto" : `${group.usedByProducts} productos`} que lo usan.`
            : "Ej. Tamaño (Chico, Grande) o Agregados (Palta, Tomate)."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        <FormField id="group-name" label="Nombre" error={errors.name?.message}>
          {(control) => <Input {...control} autoComplete="off" placeholder="Ej. Tamaño" {...form.register("name")} />}
        </FormField>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">¿Cuántas opciones puede elegir el cliente?</legend>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="group-min" label="Mínimo" error={errors.minSelect?.message} description="0 = opcional">
              {(control) => (
                <Input {...control} type="number" inputMode="numeric" min={0} max={MENU_LIMITS.optionsPerGroupMax} {...form.register("minSelect", { valueAsNumber: true })} />
              )}
            </FormField>
            <FormField id="group-max" label="Máximo" error={errors.maxSelect?.message}>
              {(control) => (
                <Input {...control} type="number" inputMode="numeric" min={1} max={MENU_LIMITS.optionsPerGroupMax} {...form.register("maxSelect", { valueAsNumber: true })} />
              )}
            </FormField>
          </div>
          <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm text-brand-soft-foreground" aria-live="polite">
            Tus clientes verán: <strong>{rulesKnown ? modifierRuleSummary(minSelect, maxSelect) : "—"}</strong>
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Opciones</legend>
          <ol className="flex flex-col gap-3" aria-label="Opciones del grupo">
            {options.fields.map((field, index) => {
              const optionErrors = errors.options?.[index];
              const label = form.getValues(`options.${index}.name`) || `opción ${index + 1}`;
              return (
                <li key={field.id} className="flex flex-col gap-2 rounded-lg border p-3" data-testid="option-row">
                  <FormField id={`option-${field.id}-name`} label={`Opción ${index + 1}`} error={optionErrors?.name?.message}>
                    {(control) => (
                      <Input {...control} autoComplete="off" placeholder={index === 0 ? "Ej. Chico" : "Ej. Grande"} {...form.register(`options.${index}.name`)} />
                    )}
                  </FormField>
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <FormField id={`option-${field.id}-price`} label="Valor extra" error={optionErrors?.priceDelta?.message}>
                        {(control) => <PriceInput {...control} placeholder="0" {...form.register(`options.${index}.priceDelta`)} />}
                      </FormField>
                    </div>
                    <ReorderButtons itemName={label} index={index} count={options.fields.length} onMove={(delta) => options.move(index, index + delta)} />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Quitar ${label}`}
                      disabled={options.fields.length === 1}
                      onClick={() => options.remove(index)}
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
          {optionsError ? (
            <p role="alert" className="text-sm text-destructive">
              {optionsError}
            </p>
          ) : null}
          {options.fields.length < MENU_LIMITS.optionsPerGroupMax ? (
            <Button type="button" variant="outline" className="self-start" onClick={() => options.append({ ...EMPTY_OPTION })}>
              <PlusIcon aria-hidden data-icon="inline-start" />
              Agregar opción
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Llegaste al máximo de {MENU_LIMITS.optionsPerGroupMax} opciones.</p>
          )}
        </fieldset>

        <FormError error={error} />
      </div>

      <div className="flex gap-2 border-t bg-muted/50 p-4">
        <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <SubmitButton pending={saving} className="flex-1 sm:ml-auto sm:flex-none">
          {group ? "Guardar cambios" : "Crear grupo"}
        </SubmitButton>
      </div>
    </form>
  );
}
