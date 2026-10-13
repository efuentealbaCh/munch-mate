"use client";

import type { PrintJobView } from "@app/types";
import { CircleCheckIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useSocketEvent } from "@/hooks/use-realtime";
import { printAgentsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useRestaurantRealtime } from "../restaurant-realtime";

/** Failed and expired jobs, newest first (the api lists one status per request). */
async function loadFailed(restaurantId: string): Promise<PrintJobView[]> {
  const [failed, expired] = await Promise.all([
    printAgentsApi.jobs(restaurantId, "failed"),
    printAgentsApi.jobs(restaurantId, "expired"),
  ]);
  return [...failed, ...expired].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * «Trabajos con error» (owner, cashier): what a print agent could not print, with «Reintentar». Refreshed
 * live by `print.job-failed`.
 */
export function FailedJobs({ restaurantId }: { restaurantId: string }) {
  const { data, error, loading, reload, setData } = useApiQuery<PrintJobView[]>(
    useCallback(() => loadFailed(restaurantId), [restaurantId]),
  );
  const { socket } = useRestaurantRealtime();
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  useSocketEvent(socket, "print.job-failed", () => reload());

  async function retry(job: PrintJobView) {
    setRetrying((current) => new Set(current).add(job.id));
    try {
      await printAgentsApi.retryJob(restaurantId, job.id);
      setData((list) => list?.filter((j) => j.id !== job.id));
      toast.success(`«${job.label}» enviado otra vez a la impresora`);
    } catch (failure) {
      if (hasCode(failure, "PRINT_JOB_NOT_RETRYABLE", "PRINT_JOB_NOT_FOUND")) {
        // Retried from another device, or already gone: the list catches up.
        toast.info(errorMessage(failure));
        reload();
      } else toast.error(errorMessage(failure));
    } finally {
      setRetrying((current) => {
        const next = new Set(current);
        next.delete(job.id);
        return next;
      });
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
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando trabajos con error">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="no-failed-jobs">
        <CircleCheckIcon className="size-4 text-success" aria-hidden />
        No hay trabajos con error.
      </p>
    );
  }
  return (
    <ul className="flex flex-col divide-y" aria-label="Trabajos con error">
      {data.map((job) => {
        const busy = retrying.has(job.id);
        return (
          <li key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" data-testid="failed-job">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {job.label}
                <Badge variant={job.status === "failed" ? "destructive" : "outline"}>
                  {job.status === "failed" ? "Error" : "Venció"}
                </Badge>
              </span>
              <span className="text-sm text-muted-foreground">
                {job.printerName || "Impresora quitada"} · {job.agentName} · {formatDateTime(job.createdAt)}
              </span>
              {job.error ? <span className="text-sm break-words text-destructive">{job.error}</span> : null}
            </div>
            <Button variant="outline" size="sm" onClick={() => void retry(job)} disabled={busy} aria-busy={busy || undefined}>
              {busy ? <Spinner aria-hidden data-icon="inline-start" /> : <RotateCcwIcon aria-hidden data-icon="inline-start" />}
              Reintentar
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
