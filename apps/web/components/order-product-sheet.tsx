"use client";

import { ORDER_LIMITS, type PublicModifierGroup, type PublicProduct } from "@app/types";
import { type ReactNode, useId, useState } from "react";
import { ProductSheetHeader, useLastNonNull } from "@/components/public-menu";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  type CartLine,
  blockedGroups,
  createLine,
  isOptionDisabled,
  isSingleChoice,
  type ModifierSelection,
  missingGroups,
  resolveModifiers,
  toggleOption,
  unitPrice,
} from "@/lib/cart";
import { modifierRuleSummary } from "@/lib/menu";
import { formatPrice, formatPriceDelta } from "@/lib/money";
import { cn } from "@/lib/utils";

interface OrderProductSheetProps {
  product: PublicProduct | null;
  currency: string;
  /** False while the restaurant is closed: the sheet still shows the product, without the order controls. */
  canOrder: boolean;
  onClose(): void;
  onAdd(line: CartLine): void;
}

/** Product detail with modifier selection, quantity and note (table page and pickup menu). */
export function OrderProductSheet({ product, currency, canOrder, onClose, onAdd }: OrderProductSheetProps) {
  const shown = useLastNonNull(product);
  return (
    <Sheet open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl sm:max-w-lg">
        {/* Keyed by product: every opening starts with a clean selection. */}
        {shown ? (
          <ProductForm key={shown.id} product={shown} currency={currency} canOrder={canOrder} onAdd={onAdd} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ProductForm({
  product,
  currency,
  canOrder,
  onAdd,
}: {
  product: PublicProduct;
  currency: string;
  canOrder: boolean;
  onAdd(line: CartLine): void;
}) {
  const [selection, setSelection] = useState<ModifierSelection>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const noteId = useId();

  const unit = unitPrice(product.price, resolveModifiers(product, selection));
  const missing = missingGroups(product, selection);
  const blocked = blockedGroups(product);
  const orderable = canOrder && product.available && blocked.length === 0;

  function submit() {
    if (!orderable || missing.length > 0) return;
    onAdd(createLine(product, selection, quantity, note));
  }

  return (
    <div className="flex flex-col">
      <ProductSheetHeader product={product} currency={currency} />

      {product.modifierGroups.length > 0 ? (
        <div className="flex flex-col gap-5 px-4 pb-2">
          {product.modifierGroups.map((group) => (
            <ModifierGroupField
              key={group.id}
              group={group}
              currency={currency}
              selection={selection}
              disabled={!orderable}
              missing={missing.includes(group)}
              onToggle={(optionId, checked) => setSelection((current) => toggleOption(current, group, optionId, checked))}
            />
          ))}
        </div>
      ) : null}

      {orderable ? (
        <div className="flex flex-col gap-2 px-4 pt-3">
          <Label htmlFor={noteId}>Nota para cocina (opcional)</Label>
          <Textarea
            id={noteId}
            rows={2}
            maxLength={ORDER_LIMITS.noteMax}
            placeholder="Ej. sin cebolla"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      ) : null}

      <div className="sticky bottom-0 mt-4 flex flex-col gap-2 border-t bg-popover px-4 py-3">
        {!canOrder ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
            El local no está recibiendo pedidos ahora.
          </p>
        ) : !product.available ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-center text-sm text-muted-foreground">Este producto está agotado.</p>
        ) : blocked.length > 0 ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-center text-sm text-muted-foreground">
            No quedan opciones disponibles en «{blocked[0]?.name}».
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <QuantityStepper value={quantity} onChange={setQuantity} label={`Cantidad de ${product.name}`} />
            <Button
              size="lg"
              className="flex-1"
              disabled={missing.length > 0}
              aria-describedby={missing.length > 0 ? `${noteId}-missing` : undefined}
              onClick={submit}
            >
              Agregar {formatPrice(unit * quantity, currency)}
            </Button>
          </div>
        )}
        {orderable && missing.length > 0 ? (
          <p id={`${noteId}-missing`} className="text-center text-sm text-muted-foreground">
            Elige {missing.map((group) => `«${group.name}»`).join(", ")} para continuar.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ModifierGroupField({
  group,
  currency,
  selection,
  disabled,
  missing,
  onToggle,
}: {
  group: PublicModifierGroup;
  currency: string;
  selection: ModifierSelection;
  disabled: boolean;
  missing: boolean;
  onToggle(optionId: string, checked: boolean): void;
}) {
  const titleId = useId();
  const chosen = selection[group.id] ?? [];
  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 border-b pb-1">
      <h3 id={titleId} className="font-semibold">
        {group.name}
      </h3>
      <span className={cn("text-sm", missing && !disabled ? "font-medium text-primary" : "text-muted-foreground")}>
        {modifierRuleSummary(group.minSelect, group.maxSelect)}
      </span>
    </div>
  );

  const optionRow = (option: PublicModifierGroup["options"][number], control: ReactNode, id: string) => (
    <label
      key={option.id}
      htmlFor={id}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5",
        option.available && !disabled ? "cursor-pointer hover:bg-muted" : "text-muted-foreground",
      )}
    >
      {control}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("break-words", !option.available && "line-through")}>{option.name}</span>
        {option.available ? null : <Badge variant="destructive">Agotado</Badge>}
      </span>
      <span className="text-sm tabular-nums">{formatPriceDelta(option.priceDelta, currency)}</span>
    </label>
  );

  if (isSingleChoice(group)) {
    return (
      <section aria-labelledby={titleId} className="flex flex-col gap-1">
        {header}
        <RadioGroup
          aria-labelledby={titleId}
          aria-required={group.minSelect > 0 || undefined}
          value={chosen[0] ?? ""}
          onValueChange={(value) => onToggle(value, true)}
          disabled={disabled}
          className="gap-0"
        >
          {group.options.map((option) => {
            const id = `${titleId}-${option.id}`;
            return optionRow(
              option,
              <RadioGroupItem id={id} value={option.id} disabled={disabled || !option.available} />,
              id,
            );
          })}
        </RadioGroup>
        {/* An optional single choice can be cleared (radios cannot be unchecked by tapping them again). */}
        {group.minSelect === 0 && chosen.length > 0 && !disabled ? (
          <Button variant="link" size="sm" className="self-start px-2" onClick={() => onToggle(chosen[0]!, false)}>
            Quitar selección
          </Button>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1">
      {header}
      <div role="group" aria-labelledby={titleId} className="flex flex-col">
        {group.options.map((option) => {
          const id = `${titleId}-${option.id}`;
          return optionRow(
            option,
            <Checkbox
              id={id}
              checked={chosen.includes(option.id)}
              disabled={disabled || isOptionDisabled(selection, group, option.id)}
              onCheckedChange={(checked) => onToggle(option.id, checked === true)}
            />,
            id,
          );
        })}
      </div>
    </section>
  );
}
