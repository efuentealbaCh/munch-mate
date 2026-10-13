"use client";

import { PROMO_LIMITS, type ProductView, WEEKDAY_LABELS } from "@app/types";
import { discountedPrice, promoSchedule } from "@app/utils";
import { BadgePercentIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { PriceInput } from "@/components/price-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { menuApi } from "@/lib/endpoints";
import { formatPrice } from "@/lib/money";
import { promoFormValues, promoFromForm } from "@/lib/promo";
import { cn } from "@/lib/utils";

/**
 * The product's discount (phase 8, owner): a percentage off or a special price, optionally some weekdays and
 * between two dates. Saved on its own (it is not part of the product form): "Guardar descuento".
 */
export function PromoField({
  restaurantId,
  product,
  onSaved,
}: {
  restaurantId: string;
  product: ProductView;
  onSaved(product: ProductView): void;
}) {
  const id = useId();
  const [values, setValues] = useState(() => promoFormValues(product.promo));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setFieldError(null);
    setValues((current) => ({ ...current, [key]: value }));
  };
  const parsed = values.enabled ? promoFromForm(values, product.price) : null;
  const preview = parsed && "promo" in parsed ? parsed.promo : null;

  async function save() {
    setError(null);
    if (parsed && "error" in parsed) {
      setFieldError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      const saved = preview
        ? await menuApi.setProductPromo(restaurantId, product.id, preview)
        : await menuApi.removeProductPromo(restaurantId, product.id);
      onSaved(saved);
      toast.success(preview ? "Descuento guardado" : "Descuento quitado");
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  const unchanged = JSON.stringify(values) === JSON.stringify(promoFormValues(product.promo));

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4 rounded-lg border p-3" data-testid="promo-field">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <Label id={`${id}-title`} htmlFor={`${id}-enabled`} className="flex items-center gap-2">
            <BadgePercentIcon className="size-4 text-primary" aria-hidden />
            Descuento
          </Label>
          <p id={`${id}-help`} className="text-sm text-muted-foreground">
            Un porcentaje o un precio especial, todos los días o solo algunos.
          </p>
        </div>
        <Switch
          id={`${id}-enabled`}
          aria-describedby={`${id}-help`}
          checked={values.enabled}
          onCheckedChange={(checked) => set("enabled", checked)}
        />
      </div>

      {values.enabled ? (
        <>
          <div role="radiogroup" aria-label="Tipo de descuento" className="grid grid-cols-2 gap-2">
            {(
              [
                ["percent", "Porcentaje"],
                ["price", "Precio especial"],
              ] as const
            ).map(([kind, label]) => (
              <Button
                key={kind}
                type="button"
                role="radio"
                aria-checked={values.kind === kind}
                variant={values.kind === kind ? "default" : "outline"}
                onClick={() => setValues((current) => ({ ...current, kind, value: "" }))}
              >
                {label}
              </Button>
            ))}
          </div>

          <FormField
            id={`${id}-value`}
            label={values.kind === "percent" ? "Porcentaje de descuento" : "Precio especial"}
            error={fieldError ?? undefined}
            description={
              values.kind === "percent"
                ? `Entre ${PROMO_LIMITS.percentMin} y ${PROMO_LIMITS.percentMax} %. Se aplica al precio del producto, no a los extras.`
                : `Menor que el precio normal (${formatPrice(product.price)}).`
            }
          >
            {(control) =>
              values.kind === "percent" ? (
                <div className="flex items-center gap-2">
                  <Input
                    {...control}
                    inputMode="numeric"
                    className="w-24"
                    placeholder="20"
                    value={values.value}
                    onChange={(event) => set("value", event.target.value)}
                  />
                  <span aria-hidden>%</span>
                </div>
              ) : (
                <PriceInput {...control} placeholder="6.990" value={values.value} onChange={(event) => set("value", event.target.value)} />
              )
            }
          </FormField>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Días</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, day) => {
                const on = values.days.includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    aria-label={label}
                    onClick={() => set("days", on ? values.days.filter((d) => d !== day) : [...values.days, day])}
                    className={cn(
                      "size-10 rounded-full border text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
                    )}
                  >
                    {label.slice(0, 2)}
                  </button>
                );
              })}
            </div>
            <p className="text-sm text-muted-foreground">Sin días marcados se aplica todos los días.</p>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <FormField id={`${id}-from`} label="Desde (opcional)">
              {(control) => <Input {...control} type="date" value={values.startsOn} onChange={(event) => set("startsOn", event.target.value)} />}
            </FormField>
            <FormField id={`${id}-to`} label="Hasta (opcional)">
              {(control) => <Input {...control} type="date" value={values.endsOn} onChange={(event) => set("endsOn", event.target.value)} />}
            </FormField>
          </div>

          <FormField id={`${id}-label`} label="Texto en el menú (opcional)" description="Ej. Martes de pizza. Sin texto se muestra el porcentaje.">
            {(control) => (
              <Input
                {...control}
                maxLength={PROMO_LIMITS.labelMax}
                value={values.label}
                onChange={(event) => set("label", event.target.value)}
              />
            )}
          </FormField>

          {preview ? (
            <p className="rounded-lg bg-brand-soft px-3 py-2 text-sm" role="status" data-testid="promo-preview">
              Se cobra <strong className="tabular-nums">{formatPrice(discountedPrice(product.price, preview))}</strong> en vez de{" "}
              <span className="tabular-nums">{formatPrice(product.price)}</span> · {promoSchedule(preview)}
            </p>
          ) : null}
        </>
      ) : null}

      <FormError error={error} />
      <div>
        <Button type="button" size="sm" variant="secondary" disabled={saving || unchanged} onClick={() => void save()}>
          {values.enabled ? "Guardar descuento" : product.promo ? "Quitar descuento" : "Guardar descuento"}
        </Button>
      </div>
    </section>
  );
}
