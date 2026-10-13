"use client";

import { PrinterIcon } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AUTO_PRINT_LABELS, AUTO_PRINT_MODES, PAPER_WIDTHS, type PrintSettings } from "@/lib/print";
import { cn } from "@/lib/utils";

/**
 * This device's receipt printer (phase 8): paper width and whether it prints orders by itself. Saved on the
 * device only, so the kitchen tablet can print every order while the cashier's phone does not.
 */
export function PrintSettingsDialog({
  settings,
  onChange,
  onTest,
}: {
  settings: PrintSettings;
  onChange(settings: PrintSettings): void;
  onTest(): void;
}) {
  const id = useId();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={settings.auto === "off" ? "outline" : "secondary"} data-testid="print-settings">
          <PrinterIcon aria-hidden data-icon="inline-start" />
          {settings.auto === "off" ? "Impresora" : "Impresión automática"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Impresora de comandas</DialogTitle>
          <DialogDescription>
            Usa la impresora térmica instalada en este dispositivo. La configuración se guarda solo aquí.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Ancho del papel</legend>
          <div className="grid grid-cols-2 gap-2">
            {PAPER_WIDTHS.map((paper) => (
              <Choice
                key={paper}
                name={`${id}-paper`}
                checked={settings.paper === paper}
                onSelect={() => onChange({ ...settings, paper })}
                label={`${paper} mm`}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Imprimir comandas solas</legend>
          {AUTO_PRINT_MODES.map((mode) => (
            <Choice
              key={mode}
              name={`${id}-auto`}
              checked={settings.auto === mode}
              onSelect={() => onChange({ ...settings, auto: mode })}
              label={AUTO_PRINT_LABELS[mode]}
            />
          ))}
          <p className="text-sm text-muted-foreground">
            Actívalo solo en el dispositivo de cocina. Para imprimir sin la ventana de impresión, abre Chrome con la opción{" "}
            <code className="rounded bg-muted px-1">--kiosk-printing</code> y deja la térmica como impresora predeterminada.
          </p>
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onTest}>
            Imprimir prueba
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Choice({ name, checked, onSelect, label }: { name: string; checked: boolean; onSelect(): void; label: string }) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm",
        checked && "border-primary bg-brand-soft",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="size-4 accent-primary" />
      {label}
    </label>
  );
}
