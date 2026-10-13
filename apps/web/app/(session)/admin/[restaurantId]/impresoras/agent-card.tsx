"use client";

import {
  type AgentPrinter,
  type AgentPrinterSettings,
  KITCHEN_PRINT_RULE_LABELS,
  KITCHEN_PRINT_RULES,
  type KitchenPrintRule,
  type MenuCategoryView,
  PRINT_PAPERS,
  type PrintAgentView,
  type PrintPaper,
} from "@app/types";
import { MonitorIcon, PencilIcon, PrinterIcon, TriangleAlertIcon, UnlinkIcon } from "lucide-react";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useNow } from "@/hooks/use-now";
import { formatDate } from "@/lib/format";
import { agentStatusLabel, categoriesLabel, COPIES_CHOICES, parseCopies, PRINTER_KIND_LABELS } from "@/lib/printers";
import { cn } from "@/lib/utils";
import { CategoriesDialog } from "./categories-dialog";

/** What a printer row can do; every change is saved at once by the screen. */
export interface PrinterActions {
  onChange(key: string, patch: Partial<AgentPrinterSettings>): void;
  onRemove(key: string): Promise<void>;
  onTest(key: string): Promise<void>;
}

/** A paired computer: its connection, its printers and their settings. */
export function AgentCard({
  agent,
  categories,
  categoriesError,
  actions,
  onRename,
  onRevoke,
}: {
  agent: PrintAgentView;
  /** Menu categories (undefined while loading or when they could not load). */
  categories: MenuCategoryView[] | undefined;
  categoriesError: unknown;
  actions: PrinterActions;
  onRename(): void;
  onRevoke(): void;
}) {
  const now = useNow(30_000);
  return (
    <li className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5" data-testid="print-agent">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <MonitorIcon className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="font-semibold break-words" data-testid="print-agent-name">
              {agent.name}
            </h3>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <Badge
                variant={agent.online ? "secondary" : "outline"}
                className={agent.online ? "bg-success/10 text-success" : "text-muted-foreground"}
                data-testid="print-agent-status"
              >
                <span className={cn("size-1.5 rounded-full", agent.online ? "bg-success" : "bg-muted-foreground")} aria-hidden />
                {agentStatusLabel(agent, now)}
              </Badge>
              {agent.appVersion ? <span>Versión {agent.appVersion}</span> : null}
              <span>Vinculado el {formatDate(agent.createdAt)}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onRename} aria-label={`Renombrar «${agent.name}»`}>
            <PencilIcon aria-hidden data-icon="inline-start" />
            Renombrar
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onRevoke} aria-label={`Desvincular «${agent.name}»`}>
            <UnlinkIcon aria-hidden data-icon="inline-start" />
            Desvincular
          </Button>
        </div>
      </header>

      {agent.printers.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground" data-testid="no-printers">
          {agent.lastSeenAt
            ? "Este equipo no encontró impresoras. Revisa que estén instaladas en Windows o agrégalas por red en el programa."
            : "Cuando el programa se conecte, sus impresoras aparecerán aquí."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={`Impresoras de ${agent.name}`}>
          {agent.printers.map((printer) => (
            <PrinterRow
              key={printer.key}
              printer={printer}
              categories={categories}
              categoriesError={categoriesError}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function PrinterRow({
  printer,
  categories,
  categoriesError,
  actions,
}: {
  printer: AgentPrinter;
  categories: MenuCategoryView[] | undefined;
  categoriesError: unknown;
  actions: PrinterActions;
}) {
  const id = useId();
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pickingCategories, setPickingCategories] = useState(false);
  const change = (patch: Partial<AgentPrinterSettings>) => actions.onChange(printer.key, patch);
  const kitchenOn = printer.kitchen !== "off";

  async function test() {
    setTesting(true);
    await actions.onTest(printer.key);
    setTesting(false);
  }

  async function remove() {
    setRemoving(true);
    await actions.onRemove(printer.key);
    setRemoving(false);
    setConfirmRemove(false);
  }

  return (
    <li
      className={cn("flex flex-col gap-3 rounded-lg border p-3", !printer.reported && "border-dashed bg-muted/40")}
      data-testid="agent-printer"
      data-printer-key={printer.key}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <PrinterIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-medium break-words">{printer.name}</span>
          <Badge variant="outline">{PRINTER_KIND_LABELS[printer.kind]}</Badge>
          {printer.reported ? null : <Badge variant="destructive">No disponible</Badge>}
        </div>
        <label htmlFor={`${id}-enabled`} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <Switch id={`${id}-enabled`} checked={printer.enabled} onCheckedChange={(enabled) => change({ enabled })} />
          Habilitada
        </label>
      </div>

      {printer.reported ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm" role="status">
          <p className="flex items-start gap-2 text-muted-foreground">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            El equipo no la encuentra: revisa que esté encendida y conectada. Mientras tanto no imprime nada.
          </p>
          <Button variant="outline" size="sm" onClick={() => setConfirmRemove(true)}>
            Quitar
          </Button>
        </div>
      )}
      {printer.reported && !printer.enabled ? (
        <p className="text-sm text-muted-foreground">Apagada: actívala para que imprima comandas o comprobantes.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <SettingField id={`${id}-kitchen`} label="Comandas">
          <NativeSelect
            id={`${id}-kitchen`}
            value={printer.kitchen}
            onChange={(event) => change({ kitchen: event.target.value as KitchenPrintRule })}
          >
            {KITCHEN_PRINT_RULES.map((rule) => (
              <option key={rule} value={rule}>
                {KITCHEN_PRINT_RULE_LABELS[rule]}
              </option>
            ))}
          </NativeSelect>
        </SettingField>
        <SettingField id={`${id}-paper`} label="Papel">
          <NativeSelect
            id={`${id}-paper`}
            value={printer.paper}
            onChange={(event) => change({ paper: event.target.value as PrintPaper })}
          >
            {PRINT_PAPERS.map((paper) => (
              <option key={paper} value={paper}>
                {paper} mm
              </option>
            ))}
          </NativeSelect>
        </SettingField>
        {kitchenOn ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium" id={`${id}-categories-label`}>
                Categorías en la comanda
              </span>
              <Button
                variant="outline"
                className="justify-between"
                onClick={() => setPickingCategories(true)}
                disabled={!categories}
                aria-describedby={`${id}-categories-label`}
                data-testid="printer-categories"
              >
                <span className="truncate">{categories ? categoriesLabel(printer.categoryIds, categories) : "Cargando…"}</span>
                <PencilIcon aria-hidden data-icon="inline-end" />
              </Button>
              {categoriesError && !categories ? (
                <span className="text-xs text-destructive">No pudimos cargar las categorías del menú.</span>
              ) : null}
            </div>
            <SettingField id={`${id}-copies`} label="Copias de cada comanda">
              <NativeSelect
                id={`${id}-copies`}
                value={String(printer.copies)}
                onChange={(event) => {
                  const copies = parseCopies(event.target.value);
                  if (copies !== null) change({ copies });
                }}
              >
                {COPIES_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </SettingField>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`${id}-receipts`} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <Switch id={`${id}-receipts`} checked={printer.receipts} onCheckedChange={(receipts) => change({ receipts })} />
          <span className="flex flex-col">
            Comprobantes de pago
            <span className="text-xs text-muted-foreground">Uno por cada pago registrado (no válido como boleta).</span>
          </span>
        </label>
        <Button variant="outline" size="sm" onClick={() => void test()} disabled={testing} aria-busy={testing || undefined}>
          {testing ? <Spinner aria-hidden data-icon="inline-start" /> : <PrinterIcon aria-hidden data-icon="inline-start" />}
          Imprimir prueba
        </Button>
      </div>

      {categories ? (
        <CategoriesDialog
          open={pickingCategories}
          printerName={printer.name}
          categories={categories}
          selected={printer.categoryIds}
          onOpenChange={setPickingCategories}
          onSave={(categoryIds) => {
            change({ categoryIds });
            setPickingCategories(false);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`¿Quitar «${printer.name}»?`}
        description="Se borra su configuración. Si el equipo la vuelve a encontrar, aparecerá apagada y tendrás que configurarla otra vez."
        confirmLabel="Quitar impresora"
        destructive
        pending={removing}
        onConfirm={() => void remove()}
      />
    </li>
  );
}

function SettingField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}
