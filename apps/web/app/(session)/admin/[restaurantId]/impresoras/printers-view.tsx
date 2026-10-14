"use client";

import type { AgentPrinterSettings, MenuCategoryView, PrintAgentsList, PrintAgentView } from "@app/types";
import { DownloadIcon, PrinterIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/use-api-query";
import { useOnVisible } from "@/hooks/use-realtime";
import { useSerialQueue } from "@/hooks/use-serial-queue";
import { menuApi, printAgentsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { canSeePrintJobs, mergePrinter, newAgents, patchPrinter, previousValues } from "@/lib/printers";
import { useRestaurant } from "../restaurant-context";
import { AgentCard, type PrinterActions } from "./agent-card";
import { FailedJobs } from "./failed-jobs";
import { PairingCard } from "./pairing-card";
import { RenameAgentDialog } from "./rename-agent-dialog";

const CARD_SPACING = "[--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]";

/** The list is refreshed this often (online/offline is not pushed to the web), and faster while a code is shown. */
const LIST_POLL_MS = 30_000;
const PAIRING_POLL_MS = 5_000;

/**
 * «Impresoras» (phase 8): the computers that print by themselves with Munch Mate Impresora (owner), and the
 * print jobs that failed (owner, cashier).
 */
export function PrintersView() {
  const { restaurant, isOwner } = useRestaurant();
  if (!canSeePrintJobs(restaurant.myRoles)) {
    return (
      <AccessDenied restaurantId={restaurant.id} description="Solo los dueños y la caja pueden ver las impresoras del local." />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {isOwner ? <OwnerPrinters restaurantId={restaurant.id} /> : null}
      <Card className={CARD_SPACING}>
        <CardHeader>
          <CardTitle>
            <h2>Trabajos con error</h2>
          </CardTitle>
          <CardDescription>
            Comandas y comprobantes que la impresora no pudo imprimir (últimos 7 días). Reintenta cuando se solucione.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FailedJobs restaurantId={restaurant.id} />
        </CardContent>
      </Card>
    </div>
  );
}

function OwnerPrinters({ restaurantId }: { restaurantId: string }) {
  const { data, error, loading, reload, setData } = useApiQuery<PrintAgentsList>(
    useCallback(() => printAgentsApi.list(restaurantId), [restaurantId]),
  );
  // Only the category names are needed (printer filters); the picker explains when they could not load.
  const menu = useApiQuery<MenuCategoryView[]>(
    useCallback(() => menuApi.get(restaurantId).then((m) => m.categories), [restaurantId]),
  );
  const enqueue = useSerialQueue();
  // Printer changes in flight: a periodic refresh would briefly undo them on screen, so it waits.
  const inFlight = useRef(0);
  const [pairingOpen, setPairingOpen] = useState(false);
  // Agents listed when the code was generated: the new one is the computer that redeemed it.
  const knownAgents = useRef<PrintAgentView[] | null>(null);
  const [renaming, setRenaming] = useState<PrintAgentView | null>(null);
  const [revoking, setRevoking] = useState<PrintAgentView | null>(null);
  const [revokePending, setRevokePending] = useState(false);

  const refresh = useCallback(() => {
    printAgentsApi.list(restaurantId).then(
      (list) => {
        if (inFlight.current > 0) return;
        setData(list);
        const before = knownAgents.current;
        const paired = before ? newAgents(before, list.agents) : [];
        if (paired.length > 0) {
          knownAgents.current = null;
          setPairingOpen(false);
          toast.success(`«${paired[0]!.name}» quedó vinculado. Activa sus impresoras abajo.`);
        }
      },
      () => {
        // A failed refresh keeps what is on screen; the next one (or a reload) tries again.
      },
    );
  }, [restaurantId, setData]);

  useEffect(() => {
    const timer = setInterval(refresh, pairingOpen ? PAIRING_POLL_MS : LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, pairingOpen]);
  useOnVisible(refresh);

  const replaceAgent = (agentId: string, update: (agent: PrintAgentView) => PrintAgentView) =>
    setData((list) => list && { ...list, agents: list.agents.map((a) => (a.id === agentId ? update(a) : a)) });

  function handleFailure(failure: unknown) {
    toast.error(errorMessage(failure));
    // Unpaired from another tab, or the agent stopped reporting the printer and it was removed meanwhile.
    if (hasCode(failure, "PRINT_AGENT_NOT_FOUND", "PRINTER_NOT_FOUND")) refresh();
    // A category deleted meanwhile.
    if (hasCode(failure, "INVALID_CATEGORY")) menu.reload();
  }

  /**
   * Saves one change of a printer at once (optimistic, rolled back on error). Requests run one after another,
   * so quick taps reach the api in order; the answer replaces only that printer.
   */
  function updatePrinter(agent: PrintAgentView, key: string, patch: Partial<AgentPrinterSettings>) {
    const printer = agent.printers.find((p) => p.key === key);
    if (!printer) return;
    const previous = previousValues(printer, patch);
    replaceAgent(agent.id, (a) => patchPrinter(a, key, patch));
    inFlight.current += 1;
    enqueue(() => printAgentsApi.updatePrinter(restaurantId, agent.id, key, patch))
      .then(
        (server) => replaceAgent(agent.id, (a) => mergePrinter(a, server, key)),
        (failure: unknown) => {
          replaceAgent(agent.id, (a) => patchPrinter(a, key, previous));
          handleFailure(failure);
        },
      )
      .finally(() => {
        inFlight.current -= 1;
      });
  }

  async function removePrinter(agent: PrintAgentView, key: string) {
    try {
      const server = await printAgentsApi.removePrinter(restaurantId, agent.id, key);
      replaceAgent(agent.id, (a) => mergePrinter(a, server, key));
      toast.success("Impresora quitada");
    } catch (failure) {
      handleFailure(failure);
    }
  }

  async function testPrinter(agent: PrintAgentView, key: string) {
    const name = agent.printers.find((p) => p.key === key)?.name ?? "la impresora";
    try {
      await printAgentsApi.testPrinter(restaurantId, agent.id, key);
      toast.success(
        agent.online ? `Prueba enviada a «${name}»` : `Prueba en cola: sale en «${name}» cuando «${agent.name}» se conecte`,
      );
    } catch (failure) {
      handleFailure(failure);
    }
  }

  async function confirmRevoke() {
    if (!revoking) return;
    setRevokePending(true);
    try {
      await printAgentsApi.revoke(restaurantId, revoking.id);
      setData((list) => list && { ...list, agents: list.agents.filter((a) => a.id !== revoking.id) });
      toast.success(`Desvinculaste «${revoking.name}»`);
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setRevokePending(false);
      setRevoking(null);
    }
  }

  const actions = (agent: PrintAgentView): PrinterActions => ({
    onChange: (key, patch) => updatePrinter(agent, key, patch),
    onRemove: (key) => removePrinter(agent, key),
    onTest: (key) => testPrinter(agent, key),
  });

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
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando impresoras">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold">Impresoras</h2>
          <p className="text-sm text-muted-foreground">
            Instala el programa en el computador de cocina (Windows) y vincúlalo con un código. Las comandas y
            comprobantes salen solos, sin ventana de impresión.
          </p>
        </div>
        {data.downloadUrl ? (
          <Button asChild variant="outline">
            <a href={data.downloadUrl} rel="noopener" data-testid="print-agent-download">
              <DownloadIcon aria-hidden data-icon="inline-start" />
              Descargar para Windows
            </a>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground sm:max-w-56 sm:text-right">
            Pide el instalador al administrador de la plataforma.
          </p>
        )}
      </div>

      <PairingCard
        restaurantId={restaurantId}
        open={pairingOpen}
        onOpen={() => {
          knownAgents.current = data.agents;
          setPairingOpen(true);
        }}
        onClose={() => {
          knownAgents.current = null;
          setPairingOpen(false);
        }}
      />

      {data.agents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          <PrinterIcon className="size-8" aria-hidden />
          <p>Todavía no hay computadores vinculados. Mientras tanto, las comandas se imprimen desde el navegador.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4" aria-label="Computadores vinculados">
          {data.agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              categories={menu.data}
              categoriesError={menu.error}
              actions={actions(agent)}
              onRename={() => setRenaming(agent)}
              onRevoke={() => setRevoking(agent)}
            />
          ))}
        </ul>
      )}

      <RenameAgentDialog
        restaurantId={restaurantId}
        agent={renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        onSaved={(agent) => replaceAgent(agent.id, (a) => ({ ...a, name: agent.name }))}
        onGone={refresh}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`¿Desvincular «${revoking?.name ?? ""}»?`}
        description="Ese computador deja de imprimir de inmediato y lo que tenga en cola no saldrá. Para volver a usarlo tendrás que vincularlo con un código nuevo."
        confirmLabel="Desvincular"
        destructive
        pending={revokePending}
        onConfirm={() => void confirmRevoke()}
      />
    </div>
  );
}
