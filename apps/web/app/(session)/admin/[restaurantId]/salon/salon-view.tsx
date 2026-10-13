"use client";

import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod, type TableSessionView } from "@app/types";
import {
  BellOffIcon,
  BellRingIcon,
  ConciergeBellIcon,
  HandPlatterIcon,
  PrinterIcon,
  ReceiptTextIcon,
  UtensilsCrossedIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/access-denied";
import { FormError } from "@/components/form-error";
import { PriceInput } from "@/components/price-input";
import { useTicketPrinter } from "@/components/ticket-printer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useChime } from "@/hooks/use-chime";
import { useNow } from "@/hooks/use-now";
import { useSocketEvent } from "@/hooks/use-realtime";
import { localStore } from "@/lib/browser-storage";
import { tableSessionsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { initialTip, isNewCall, minutesAgoLabel, parseTip, sortSessions, upsertSession } from "@/lib/floor";
import { formatPrice, formatPriceInput } from "@/lib/money";
import { canServeTables } from "@/lib/orders-board";
import { loadPrintSettings, preBillTicket } from "@/lib/print";
import { cn } from "@/lib/utils";
import { METHOD_ICONS } from "../pedidos/order-dialogs";
import { useRestaurant } from "../restaurant-context";
import { useRestaurantRealtime } from "../restaurant-realtime";

/** "Salón" (phase 8): the tables with an open account, their calls, and charging them with the tip. */
export function SalonView() {
  const { restaurant } = useRestaurant();
  if (!canServeTables(restaurant.myRoles)) {
    return (
      <AccessDenied
        restaurantId={restaurant.id}
        title="Solo para el salón"
        description="El salón es para dueños, caja y garzones. Pídele al dueño que te agregue ese rol."
      />
    );
  }
  return <Salon />;
}

function Salon() {
  const { restaurant } = useRestaurant();
  const { socket, syncCount } = useRestaurantRealtime();
  const [sessions, setSessions] = useState<TableSessionView[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [charging, setCharging] = useState<TableSessionView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const chime = useChime();
  const now = useNow(30_000);
  const printer = useTicketPrinter(loadPrintSettings(localStore(), restaurant.id).paper);

  const load = useCallback(async () => {
    try {
      setSessions(await tableSessionsApi.list(restaurant.id));
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [restaurant.id]);

  // On mount and after every (re)subscription: updates missed while disconnected are not replayed.
  useEffect(() => {
    void load();
  }, [load, syncCount]);

  useSocketEvent(socket, "table.updated", (update) => {
    if (sessions && isNewCall(sessions.find((s) => s.id === update.id), update)) {
      chime.play();
      toast(update.billRequestedAt && !update.waiterCalledAt ? `${update.tableLabel} pidió la cuenta` : `${update.tableLabel} llama al garzón`);
    }
    setSessions((current) => (current ? upsertSession(current, update) : current));
    // The open charge dialog follows the account (a new order, the tip the customer chose).
    setCharging((current) => (current?.id === update.id ? (update.status === "open" ? update : null) : current));
  });

  async function attend(session: TableSessionView, kind: "waiter" | "bill") {
    setBusy(session.id);
    try {
      const updated = await tableSessionsApi.attend(restaurant.id, session.id, kind);
      setSessions((current) => (current ? upsertSession(current, updated) : current));
    } catch (failure) {
      toast.error(errorMessage(failure));
      if (hasCode(failure, "TABLE_SESSION_NOT_FOUND")) void load();
    } finally {
      setBusy(null);
    }
  }

  if (!sessions) {
    return error ? (
      <div className="flex flex-col items-start gap-3">
        <FormError error={error} />
        <Button variant="outline" onClick={() => void load()}>
          Reintentar
        </Button>
      </div>
    ) : (
      <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Cargando salón">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const sorted = sortSessions(sessions);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-xl font-bold tracking-tight">Salón</h2>
          <p className="text-sm text-muted-foreground">Mesas con cuenta abierta. Los llamados aparecen primero.</p>
        </div>
        <Button variant={chime.enabled ? "secondary" : "outline"} onClick={chime.toggle} aria-pressed={chime.enabled}>
          {chime.enabled ? <BellRingIcon aria-hidden data-icon="inline-start" /> : <BellOffIcon aria-hidden data-icon="inline-start" />}
          {chime.enabled ? "Sonido activado" : "Activar sonido"}
        </Button>
      </div>

      {sorted.length === 0 ? (
        <p className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          <UtensilsCrossedIcon className="size-8" aria-hidden />
          No hay mesas con cuenta abierta. Aparecen al llegar el primer pedido o un llamado.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Mesas con cuenta abierta">
          {sorted.map((session) => (
            <li key={session.id}>
              <TableCard
                session={session}
                now={now}
                busy={busy === session.id}
                onAttend={(kind) => void attend(session, kind)}
                onCharge={() => setCharging(session)}
                onPrint={() => printer.print(preBillTicket(session, restaurant.name))}
              />
            </li>
          ))}
        </ul>
      )}

      <ChargeDialog
        restaurantId={restaurant.id}
        session={charging}
        onOpenChange={(open) => !open && setCharging(null)}
        onClosed={(closed) => {
          setSessions((current) => (current ? upsertSession(current, closed) : current));
          setCharging(null);
          toast.success(`${closed.tableLabel} cobrada`);
        }}
      />
      {printer.element}
    </div>
  );
}

function TableCard({
  session,
  now,
  busy,
  onAttend,
  onCharge,
  onPrint,
}: {
  session: TableSessionView;
  now: number;
  busy: boolean;
  onAttend(kind: "waiter" | "bill"): void;
  onCharge(): void;
  onPrint(): void;
}) {
  const calling = session.waiterCalledAt !== null;
  const billing = session.billRequestedAt !== null;
  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10",
        (calling || billing) && "ring-2 ring-primary",
      )}
      aria-label={`Cuenta de ${session.tableLabel}`}
      data-testid="table-session"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-lg font-bold">{session.tableLabel}</h3>
          <span className="text-xs text-muted-foreground">
            Desde las {new Date(session.openedAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} ·{" "}
            {session.orderCount} {session.orderCount === 1 ? "pedido" : "pedidos"}
          </span>
        </div>
        <span className="text-right text-lg font-bold tabular-nums" data-testid="session-subtotal">
          {formatPrice(session.subtotal, session.currency)}
        </span>
      </header>

      {calling ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-brand-soft px-3 py-2" role="status" data-testid="waiter-call">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <HandPlatterIcon className="size-4 text-primary" aria-hidden />
            Llama al garzón · {minutesAgoLabel(session.waiterCalledAt!, now)}
          </span>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAttend("waiter")}>
            Atendido
          </Button>
        </div>
      ) : null}
      {billing ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-soft px-3 py-2" role="status" data-testid="bill-request">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ReceiptTextIcon className="size-4 text-primary" aria-hidden />
            Pidió la cuenta · {minutesAgoLabel(session.billRequestedAt!, now)}
            {session.requestedTip !== null ? ` · propina ${formatPrice(session.requestedTip, session.currency)}` : ""}
          </span>
        </div>
      ) : null}

      {session.lines.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-sm" aria-label={`Consumo de ${session.tableLabel}`}>
          {session.lines.map((line, index) => (
            <li key={`${line.name}-${index}`} className="flex justify-between gap-2">
              <span className="min-w-0">
                {line.quantity} × {line.name}
                {line.options.length > 0 ? <span className="text-muted-foreground"> ({line.options.join(", ")})</span> : null}
              </span>
              <span className="tabular-nums">{formatPrice(line.total, session.currency)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Todavía sin pedidos.</p>
      )}
      {session.ordersInProgress > 0 ? (
        <Badge variant="outline" className="self-start">
          {session.ordersInProgress} en preparación
        </Badge>
      ) : null}

      <div className="mt-auto flex flex-wrap gap-2">
        <Button variant="outline" className="flex-1" onClick={onPrint} disabled={session.orderCount === 0}>
          <PrinterIcon aria-hidden data-icon="inline-start" />
          Precuenta
        </Button>
        <Button className="flex-1" onClick={onCharge} disabled={busy} data-testid="charge-table">
          <ConciergeBellIcon aria-hidden data-icon="inline-start" />
          {session.orderCount === 0 ? "Liberar mesa" : "Cobrar"}
        </Button>
      </div>
    </article>
  );
}

/** Charging a table: payment method and the final tip (what the customer chose, or the suggestion). */
function ChargeDialog({
  restaurantId,
  session,
  onOpenChange,
  onClosed,
}: {
  restaurantId: string;
  session: TableSessionView | null;
  onOpenChange(open: boolean): void;
  onClosed(session: TableSessionView): void;
}) {
  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {session ? <ChargeForm key={session.id} restaurantId={restaurantId} session={session} onClosed={onClosed} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ChargeForm({
  restaurantId,
  session,
  onClosed,
}: {
  restaurantId: string;
  session: TableSessionView;
  onClosed(session: TableSessionView): void;
}) {
  const id = useId();
  const empty = session.orderCount === 0;
  const [tipText, setTipText] = useState(() => (empty ? "" : formatPriceInput(initialTip(session))));
  const [method, setMethod] = useState<PaymentMethod | null>(empty ? "cash" : null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tip = parseTip(tipText);

  async function close() {
    if (!method || tip === null) return;
    setPending(true);
    setError(null);
    try {
      onClosed(await tableSessionsApi.close(restaurantId, session.id, { method, tip: empty ? 0 : tip }));
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{empty ? `Liberar ${session.tableLabel}` : `Cobrar ${session.tableLabel}`}</DialogTitle>
        <DialogDescription>
          {empty
            ? "La mesa no tiene pedidos: se cierra la cuenta sin cobrar."
            : `Consumo ${formatPrice(session.subtotal, session.currency)}. Se marcan pagados ${session.unpaidOrders} ${session.unpaidOrders === 1 ? "pedido" : "pedidos"}.`}
        </DialogDescription>
      </DialogHeader>
      {empty ? null : (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-tip`} className="text-sm font-medium">
              Propina {session.tipPercent > 0 ? `(sugerida ${session.tipPercent} %: ${formatPrice(session.suggestedTip, session.currency)})` : ""}
            </label>
            <PriceInput id={`${id}-tip`} value={tipText} onChange={(event) => setTipText(event.target.value)} aria-invalid={tip === null || undefined} />
            {tip === null ? <p className="text-sm text-destructive">Escribe un monto válido, ej. 2.000</p> : null}
            <p className="text-sm">
              Total a cobrar:{" "}
              <strong className="tabular-nums" data-testid="charge-total">
                {formatPrice(session.subtotal + (tip ?? 0), session.currency)}
              </strong>
            </p>
          </div>
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Medio de pago">
            {PAYMENT_METHODS.map((option) => {
              const Icon = METHOD_ICONS[option];
              return (
                <Button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={method === option}
                  variant={method === option ? "default" : "outline"}
                  size="lg"
                  onClick={() => setMethod(option)}
                >
                  <Icon aria-hidden data-icon="inline-start" />
                  {PAYMENT_METHOD_LABELS[option]}
                </Button>
              );
            })}
          </div>
        </>
      )}
      <FormError error={error} />
      <DialogFooter>
        <Button size="lg" className="w-full" disabled={!method || tip === null || pending} onClick={() => void close()} data-testid="confirm-charge">
          {empty ? "Liberar mesa" : "Cobrar y cerrar la cuenta"}
        </Button>
      </DialogFooter>
    </>
  );
}
