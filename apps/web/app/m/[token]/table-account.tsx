"use client";

import type { PublicTableBill } from "@app/types";
import { BellRingIcon, CheckCircle2Icon, HandPlatterIcon, ReceiptTextIcon } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { PriceInput } from "@/components/price-input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { publicOrdersApi } from "@/lib/endpoints";
import { errorMessage } from "@/lib/errors";
import { formatPrice } from "@/lib/money";
import { billStage, defaultTipMode, type TipMode, tipFromForm } from "@/lib/table-bill";
import { cn } from "@/lib/utils";
import { subscribeWithTimeout, useOnVisible, useRealtime, useSocketEvent } from "@/hooks/use-realtime";

/** The table's account (phase 8), kept in sync over Socket.IO with the other phones at the table. */
function useTableBill(tableToken: string) {
  const [bill, setBill] = useState<PublicTableBill | null>(null);
  const refresh = useCallback(async () => {
    try {
      setBill(await publicOrdersApi.tableBill(tableToken));
    } catch {
      // The account is an extra: the menu and the orders work without it. The next event or visit retries.
    }
  }, [tableToken]);
  const { socket } = useRealtime(`table:${tableToken}`, {
    enabled: true,
    subscribe: (client) => subscribeWithTimeout(client, "table.subscribe", tableToken),
    onSubscribed: () => void refresh(),
  });
  useSocketEvent(socket, "table.bill", setBill);
  useOnVisible(() => void refresh());
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { bill, setBill, refresh };
}

/**
 * "Llamar al garzón" and "Mi cuenta" on the table page: the account adds up every order of the table, the
 * waiter's alert shows on the staff's "Salón" screen, and asking for the bill offers the suggested tip.
 */
export function TableAccount({ tableToken, currency, ordersPlaced }: { tableToken: string; currency: string; ordersPlaced: number }) {
  const { bill, setBill, refresh } = useTableBill(tableToken);
  const [open, setOpen] = useState(false);
  const [calling, setCalling] = useState(false);
  const stage = billStage(bill);

  // A new order of this phone changes the account: read it again (the event usually arrives first).
  useEffect(() => {
    if (ordersPlaced > 0) void refresh();
  }, [ordersPlaced, refresh]);

  async function callWaiter() {
    setCalling(true);
    try {
      setBill(await publicOrdersApi.callWaiter(tableToken));
      toast.success("Avisamos al garzón. Ya viene.");
    } catch (failure) {
      toast.error(errorMessage(failure));
    } finally {
      setCalling(false);
    }
  }

  const called = Boolean(bill?.waiterCalledAt);
  return (
    <>
      <div className="mx-auto flex max-w-3xl flex-wrap gap-2 px-4 pb-3">
        <Button
          type="button"
          variant={called ? "secondary" : "outline"}
          size="sm"
          disabled={calling || called}
          onClick={() => void callWaiter()}
          data-testid="call-waiter"
        >
          {called ? <BellRingIcon aria-hidden data-icon="inline-start" /> : <HandPlatterIcon aria-hidden data-icon="inline-start" />}
          {called ? "Garzón avisado" : "Llamar al garzón"}
        </Button>
        {stage === "empty" ? null : (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="my-bill">
            <ReceiptTextIcon aria-hidden data-icon="inline-start" />
            {stage === "paid" ? "Cuenta pagada" : `Mi cuenta · ${formatPrice(bill!.subtotal, currency)}`}
          </Button>
        )}
      </div>
      <Sheet open={open && bill !== null} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="mx-auto max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl sm:max-w-lg">
          {bill ? <BillDetail bill={bill} currency={currency} tableToken={tableToken} onBill={setBill} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function BillDetail({
  bill,
  currency,
  tableToken,
  onBill,
}: {
  bill: PublicTableBill;
  currency: string;
  tableToken: string;
  onBill(bill: PublicTableBill): void;
}) {
  const id = useId();
  const stage = billStage(bill);
  const [mode, setMode] = useState<TipMode>(() => defaultTipMode(bill));
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tip = tipFromForm(mode, amount, bill);

  async function requestBill() {
    if (!tip) return;
    setSending(true);
    setError(null);
    try {
      onBill(await publicOrdersApi.requestBill(tableToken, tip.choice));
      toast.success("Pedimos tu cuenta. El garzón viene a cobrar.");
    } catch (failure) {
      setError(failure);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col" data-testid="bill-sheet">
      <SheetHeader className="border-b pr-12">
        <SheetTitle className="text-xl font-bold">Cuenta de {bill.tableLabel}</SheetTitle>
        <SheetDescription>
          {stage === "paid"
            ? "Esta cuenta ya está pagada. ¡Gracias!"
            : bill.ordersInProgress > 0
              ? `Todos los pedidos de la mesa. ${bill.ordersInProgress === 1 ? "Uno aún está" : `${bill.ordersInProgress} aún están`} en preparación.`
              : "Todos los pedidos de la mesa."}
        </SheetDescription>
      </SheetHeader>

      <ul className="flex flex-col divide-y px-4" aria-label="Detalle de la cuenta">
        {bill.lines.map((line, index) => (
          <li key={`${line.name}-${index}`} className="flex items-start justify-between gap-3 py-2.5" data-testid="bill-line">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">
                {line.quantity} × {line.name}
              </span>
              {line.options.length > 0 ? <span className="text-sm text-muted-foreground">{line.options.join(" · ")}</span> : null}
            </span>
            <span className="tabular-nums">{formatPrice(line.total, currency)}</span>
          </li>
        ))}
      </ul>

      <dl className="flex flex-col gap-1 border-t px-4 py-3 text-sm">
        <div className="flex justify-between font-semibold">
          <dt>Consumo</dt>
          <dd className="tabular-nums" data-testid="bill-subtotal">
            {formatPrice(bill.subtotal, currency)}
          </dd>
        </div>
        {stage === "requested" && bill.requestedTip !== null ? (
          <>
            <div className="flex justify-between text-muted-foreground">
              <dt>Propina</dt>
              <dd className="tabular-nums">{formatPrice(bill.requestedTip, currency)}</dd>
            </div>
            <div className="flex justify-between text-base font-bold">
              <dt>Total a pagar</dt>
              <dd className="tabular-nums" data-testid="bill-total">
                {formatPrice(bill.subtotal + bill.requestedTip, currency)}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {stage === "open" ? (
        <fieldset className="flex flex-col gap-2 border-t px-4 py-3">
          <legend className="mb-1 font-semibold">Propina</legend>
          {bill.tipPercent > 0 ? (
            <TipOption
              name={id}
              checked={mode === "suggested"}
              onSelect={() => setMode("suggested")}
              label={`Sugerida ${bill.tipPercent} %`}
              amount={formatPrice(bill.suggestedTip, currency)}
            />
          ) : null}
          <TipOption name={id} checked={mode === "amount"} onSelect={() => setMode("amount")} label="Otro monto" />
          {mode === "amount" ? (
            <PriceInput aria-label="Monto de la propina" placeholder="2.000" value={amount} onChange={(event) => setAmount(event.target.value)} />
          ) : null}
          <TipOption name={id} checked={mode === "none"} onSelect={() => setMode("none")} label="Sin propina" />
          <p className="text-xs text-muted-foreground">La propina es voluntaria y va íntegra al equipo. La confirmas con el garzón al pagar.</p>
          <FormError error={error} message={mode === "amount" && amount && !tip ? "Escribe un monto válido, ej. 2.000" : null} />
          <Button type="button" size="lg" disabled={!tip || sending} onClick={() => void requestBill()} data-testid="request-bill">
            Pedir la cuenta{tip ? ` · ${formatPrice(bill.subtotal + tip.amount, currency)}` : ""}
          </Button>
        </fieldset>
      ) : stage === "requested" ? (
        <p className="m-4 flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm font-medium" role="status" data-testid="bill-requested">
          <BellRingIcon className="size-4 shrink-0" aria-hidden />
          Cuenta pedida. El garzón viene a cobrar.
        </p>
      ) : stage === "paid" ? (
        <p className="m-4 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success" role="status" data-testid="bill-paid">
          <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
          Cuenta pagada. ¡Gracias por venir!
        </p>
      ) : null}
    </div>
  );
}

function TipOption({
  name,
  checked,
  onSelect,
  label,
  amount,
}: {
  name: string;
  checked: boolean;
  onSelect(): void;
  label: string;
  amount?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2",
        checked && "border-primary bg-brand-soft",
      )}
    >
      <span className="flex items-center gap-3">
        <input type="radio" name={name} checked={checked} onChange={onSelect} className="size-4 accent-primary" />
        {label}
      </span>
      {amount ? <span className="font-semibold tabular-nums">{amount}</span> : null}
    </label>
  );
}
