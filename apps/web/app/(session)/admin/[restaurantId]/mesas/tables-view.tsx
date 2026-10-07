"use client";

import type { TableView } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CopyIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  ExternalLinkIcon,
  ListPlusIcon,
  PencilIcon,
  PlusIcon,
  QrCodeIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSocketEvent } from "@/hooks/use-realtime";
import { ApiError } from "@/lib/api";
import { tablesApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { TABLE_LABEL_MAX, tableUrl } from "@/lib/tables";
import { cn } from "@/lib/utils";
import { type TableValues, tableSchema } from "@/lib/validation";
import { useRestaurant } from "../restaurant-context";
import { useRestaurantRealtime } from "../restaurant-realtime";
import { BulkTablesDialog, RenameTableDialog } from "./table-dialogs";

/** The PDF is polled every 2 s as a fallback for the `qr-sheet.ready` event, for at most 60 s. */
const QR_POLL_MS = 2_000;
const QR_TIMEOUT_MS = 60_000;

export function TablesView() {
  const { restaurant, isOwner } = useRestaurant();
  if (!isOwner) {
    return <AccessDenied restaurantId={restaurant.id} description="Solo los dueños pueden administrar las mesas y sus códigos QR." />;
  }
  return <Tables restaurantId={restaurant.id} />;
}

/** window.location.origin after hydration ("" on the server): QR codes point to the current host. */
function useOrigin(): string {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

function Tables({ restaurantId }: { restaurantId: string }) {
  const { data, error, loading, reload, setData } = useApiQuery<TableView[]>(
    useCallback(() => tablesApi.list(restaurantId), [restaurantId]),
  );
  const { reload: reloadRestaurant } = useRestaurant();
  const origin = useOrigin();
  const [renaming, setRenaming] = useState<TableView | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleting, setDeleting] = useState<TableView | null>(null);
  const [regenerating, setRegenerating] = useState<TableView | null>(null);
  const [pending, setPending] = useState(false);
  const pdf = useQrSheet(restaurantId);

  const replace = (table: TableView) => setData((list) => list?.map((t) => (t.id === table.id ? table : t)));
  // New tables go to the end; the next load brings the api's natural order ("Mesa 2" before "Mesa 10").
  const append = (table: TableView) => setData((list) => [...(list ?? []), table]);

  function handleFailure(failure: unknown) {
    toast.error(errorMessage(failure));
    if (hasCode(failure, "TABLE_NOT_FOUND")) reload();
    if (hasCode(failure, "FORBIDDEN_ROLE")) reloadRestaurant();
  }

  function setActive(table: TableView, active: boolean) {
    replace({ ...table, active });
    tablesApi.update(restaurantId, table.id, { active }).then(replace, (failure: unknown) => {
      replace(table);
      handleFailure(failure);
    });
  }

  async function confirmDelete() {
    if (!deleting) return;
    setPending(true);
    try {
      await tablesApi.delete(restaurantId, deleting.id);
      setData((list) => list?.filter((t) => t.id !== deleting.id));
      toast.success(`Eliminaste «${deleting.label}»`);
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setPending(false);
      setDeleting(null);
    }
  }

  async function confirmRegenerate() {
    if (!regenerating) return;
    setPending(true);
    try {
      replace(await tablesApi.regenerateToken(restaurantId, regenerating.id));
      toast.success(`Nuevo código para «${regenerating.label}». Imprime su QR otra vez.`);
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setPending(false);
      setRegenerating(null);
    }
  }

  async function copyLink(table: TableView) {
    try {
      await navigator.clipboard.writeText(tableUrl(origin, table.token));
      toast.success("Enlace copiado");
    } catch {
      toast.error("No pudimos copiar el enlace. Ábrelo y cópialo desde la barra de direcciones.");
    }
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormError error={error} />
        <Button variant="outline" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if ((loading && !data) || !data) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando mesas">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const activeCount = data.filter((t) => t.active).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">Mesas</h2>
          <p className="text-sm text-muted-foreground">
            Cada mesa tiene su código QR. Al escanearlo, tus clientes ven el menú y piden desde su teléfono.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void pdf.download()}
          disabled={pdf.working || activeCount === 0}
          aria-busy={pdf.working || undefined}
        >
          {pdf.working ? <Spinner aria-hidden data-icon="inline-start" /> : <DownloadIcon aria-hidden data-icon="inline-start" />}
          {pdf.working ? "Generando PDF…" : "Descargar PDF con todos los QR"}
        </Button>
      </div>

      <AddTableForm restaurantId={restaurantId} onCreated={append} onBulk={() => setBulkOpen(true)} />

      {data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          <QrCodeIcon className="size-8" aria-hidden />
          <p>Todavía no tienes mesas. Agrega la primera o crea varias de una vez.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Lista de mesas">
          {data.map((table) => (
            <TableRow
              key={table.id}
              table={table}
              url={origin ? tableUrl(origin, table.token) : ""}
              onActive={(active) => setActive(table, active)}
              onRename={() => setRenaming(table)}
              onCopy={() => void copyLink(table)}
              onRegenerate={() => setRegenerating(table)}
              onDelete={() => setDeleting(table)}
            />
          ))}
        </ul>
      )}

      <RenameTableDialog restaurantId={restaurantId} table={renaming} onOpenChange={(open) => !open && setRenaming(null)} onSaved={replace} />
      <BulkTablesDialog
        restaurantId={restaurantId}
        open={bulkOpen}
        existing={data.map((t) => t.label)}
        onOpenChange={(open) => {
          setBulkOpen(open);
          // Back to the api's natural order once the batch is done.
          if (!open) reload();
        }}
        onCreated={append}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`¿Eliminar «${deleting?.label ?? ""}»?`}
        description="Su código QR deja de funcionar. Los pedidos ya hechos desde esta mesa no cambian."
        confirmLabel="Eliminar mesa"
        destructive
        pending={pending}
        onConfirm={() => void confirmDelete()}
      />
      <ConfirmDialog
        open={regenerating !== null}
        onOpenChange={(open) => !open && setRegenerating(null)}
        title={`¿Regenerar el código de «${regenerating?.label ?? ""}»?`}
        description="El QR impreso de esta mesa dejará de funcionar de inmediato y tendrás que imprimir el nuevo. Úsalo si alguien está pidiendo desde fuera del local con una foto del QR."
        confirmLabel="Regenerar código"
        destructive
        pending={pending}
        onConfirm={() => void confirmRegenerate()}
      />
    </div>
  );
}

function AddTableForm({
  restaurantId,
  onCreated,
  onBulk,
}: {
  restaurantId: string;
  onCreated(table: TableView): void;
  onBulk(): void;
}) {
  const form = useForm<TableValues>({ resolver: zodResolver(tableSchema), defaultValues: { label: "" } });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const labelError = form.formState.errors.label?.message;

  async function submit(values: TableValues) {
    setSaving(true);
    setError(null);
    try {
      const table = await tablesApi.create(restaurantId, values.label);
      onCreated(table);
      form.reset({ label: "" });
      toast.success(`Mesa «${table.label}» creada`);
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-2" aria-label="Agregar mesa">
      <label htmlFor={inputId} className="text-sm font-medium">
        Nueva mesa
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={inputId}
          placeholder="Ej. Mesa 4 o Terraza 2"
          autoComplete="off"
          maxLength={TABLE_LABEL_MAX}
          className="h-10 min-w-0 flex-1 basis-48"
          aria-invalid={labelError ? true : undefined}
          aria-describedby={labelError ? `${inputId}-error` : undefined}
          {...form.register("label")}
        />
        <SubmitButton pending={saving}>
          <PlusIcon aria-hidden data-icon="inline-start" />
          Agregar
        </SubmitButton>
        <Button type="button" variant="outline" onClick={onBulk}>
          <ListPlusIcon aria-hidden data-icon="inline-start" />
          Agregar varias
        </Button>
      </div>
      {labelError ? (
        <p id={`${inputId}-error`} className="text-sm text-destructive">
          {labelError}
        </p>
      ) : null}
      <FormError error={error} />
    </form>
  );
}

function TableRow({
  table,
  url,
  onActive,
  onRename,
  onCopy,
  onRegenerate,
  onDelete,
}: {
  table: TableView;
  url: string;
  onActive(active: boolean): void;
  onRename(): void;
  onCopy(): void;
  onRegenerate(): void;
  onDelete(): void;
}) {
  const switchId = useId();
  return (
    <li className={cn("flex items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10", !table.active && "opacity-70")} data-testid="table-row">
      <QrPreview value={url} label={table.label} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold break-words">{table.label}</span>
        <label htmlFor={switchId} className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch id={switchId} checked={table.active} onCheckedChange={onActive} aria-label={`${table.label} activa`} />
          <span className={table.active ? "text-success" : "text-muted-foreground"}>{table.active ? "Activa" : "Inactiva"}</span>
        </label>
        <span className="truncate font-mono text-xs text-muted-foreground" data-testid="table-code">
          /m/{table.token}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Acciones de ${table.label}`}>
            <EllipsisVerticalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem className="min-h-10" asChild>
            <a href={url || `/m/${table.token}`} target="_blank" rel="noopener">
              <ExternalLinkIcon aria-hidden />
              Abrir página de la mesa
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-10" onSelect={onCopy}>
            <CopyIcon aria-hidden />
            Copiar enlace
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-10" onSelect={onRename}>
            <PencilIcon aria-hidden />
            Renombrar
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-10" onSelect={onRegenerate}>
            <RefreshCwIcon aria-hidden />
            Regenerar código
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-10" variant="destructive" onSelect={onDelete}>
            <Trash2Icon aria-hidden />
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** QR drawn in the browser (no request): the same URL the printable PDF encodes. */
function QrPreview({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    let current = true;
    QRCode.toDataURL(value, { margin: 1, width: 192, errorCorrectionLevel: "M" }).then(
      (url) => current && setSrc(url),
      () => current && setSrc(null),
    );
    return () => {
      current = false;
    };
  }, [value]);
  return src ? (
    <img src={src} width={96} height={96} alt={`Código QR de ${label}`} className="size-24 shrink-0 rounded-md bg-white" />
  ) : (
    <Skeleton className="size-24 shrink-0" />
  );
}

/**
 * Asks the workers for the printable PDF and downloads it when ready: waits for the `qr-sheet.ready` event,
 * with polling every 2 s as a fallback (socket down, event missed), for at most 60 s.
 */
function useQrSheet(restaurantId: string) {
  const { socket } = useRestaurantRealtime();
  const [working, setWorking] = useState(false);
  // Wakes up the waiting loop of a job as soon as its event arrives.
  const wakers = useRef(new Map<string, () => void>());

  useSocketEvent(socket, "qr-sheet.ready", ({ restaurantId: id, jobId }) => {
    if (id === restaurantId) wakers.current.get(jobId)?.();
  });

  const waitForEventOrTimeout = (jobId: string) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        wakers.current.delete(jobId);
        resolve();
      };
      const timer = setTimeout(done, QR_POLL_MS);
      wakers.current.set(jobId, done);
    });

  async function download() {
    setWorking(true);
    try {
      const { jobId } = await tablesApi.requestQrSheet(restaurantId);
      const deadline = Date.now() + QR_TIMEOUT_MS;
      let pdf: Blob | null = null;
      while (!pdf) {
        if (Date.now() > deadline) throw new ApiError(0, "QR_SHEET_TIMEOUT", "El PDF está tardando más de lo normal. Intenta de nuevo en un rato.");
        await waitForEventOrTimeout(jobId);
        pdf = await tablesApi.qrSheet(restaurantId, jobId);
      }
      saveBlob(pdf, "codigos-qr-mesas.pdf");
      toast.success("PDF descargado");
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setWorking(false);
    }
  }

  return { working, download };
}

/** Triggers a browser download of an in-memory file. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking right away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
