"use client";

import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type SetTableSplitInput,
  SPLIT_LIMITS,
  type TablePaymentView,
  type TableSessionView,
} from "@app/types";
import { CheckCircle2Icon, Undo2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { PriceInput } from "@/components/price-input";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { tableSessionsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { parseTip } from "@/lib/floor";
import { formatPrice, formatPriceInput } from "@/lib/money";
import {
  amountFromInput,
  CHARGE_MODE_LABELS,
  CHARGE_MODES,
  type ChargeMode,
  equalPartRows,
  type ItemSelection,
  itemLineKey,
  minSplitParts,
  modeOfSplit,
  paidItemsDetail,
  paymentKindLabel,
  selectionSummary,
  splitInputFor,
  suggestedPaymentTip,
  unitsLabel,
  unpaidUnits,
} from "@/lib/split-bill";
import { cn } from "@/lib/utils";
import { METHOD_ICONS } from "../pedidos/order-dialogs";

/** Errors that mean the dialog showed an old copy of the account: it is read again. */
const STALE_CODES = [
  "TABLE_SESSION_CHANGED",
  "SPLIT_MODE_MISMATCH",
  "SPLIT_PART_PAID",
  "SPLIT_PARTS_PAID",
  "PAYMENT_EXCEEDS_BALANCE",
  "INVALID_SPLIT_ITEMS",
  "NOTHING_TO_PAY",
  "TABLE_SESSION_CLOSED",
  "TABLE_PAYMENT_NOT_FOUND",
];

const clock = (iso: string) => new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

interface ChargeDialogProps {
  restaurantId: string;
  session: TableSessionView | null;
  onOpenChange(open: boolean): void;
  /** A newer copy of the account (a payment, a plan, a deletion, or closed by someone else). */
  onUpdated(session: TableSessionView): void;
  /** This dialog's payment (or "Liberar mesa") closed the account. */
  onClosed(session: TableSessionView): void;
  /** The account no longer exists as open (404): the floor reloads. */
  onGone(): void;
}

/**
 * «Cobrar Mesa 4»: what was consumed, paid and is left, and the four ways to charge it — everything at once
 * (`close`), equal parts, by products or free amounts (each a plan the table's phones see, plus partial
 * payments with their own method and tip). The payment that completes the bill closes the account.
 */
export function ChargeDialog({ session, onOpenChange, ...props }: ChargeDialogProps) {
  return (
    <Dialog open={session !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        {session ? <ChargeForm key={session.id} session={session} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type Draft = { kind: "equal"; part: number } | { kind: "items" } | { kind: "amount"; amount: number };

function ChargeForm({
  restaurantId,
  session,
  onUpdated,
  onClosed,
  onGone,
}: Omit<ChargeDialogProps, "session" | "onOpenChange"> & { session: TableSessionView }) {
  const empty = session.orderCount === 0 && session.payments.length === 0;
  const money = (amount: number) => formatPrice(amount, session.currency);
  const [mode, setMode] = useState<ChargeMode>(() => modeOfSplit(session.split));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selection, setSelection] = useState<ItemSelection>({});
  const [amountText, setAmountText] = useState("");
  const [planPending, setPlanPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [overpaid, setOverpaid] = useState(false);
  const [deleting, setDeleting] = useState<TablePaymentView | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  // Another waiter changed the plan (it arrives through table.updated): follow it, unless our own change is
  // in flight (its answer brings the plan we chose).
  const splitKey = JSON.stringify(session.split);
  const [seenSplit, setSeenSplit] = useState(splitKey);
  if (splitKey !== seenSplit) {
    setSeenSplit(splitKey);
    if (!planPending && modeOfSplit(session.split) !== mode) {
      setMode(modeOfSplit(session.split));
      setDraft(null);
    }
  }

  // What was being charged was charged by someone else meanwhile (a part, every product chosen): back to the list.
  const items = selectionSummary(session.itemLines, selection);
  if (draft?.kind === "equal" && !session.equalPart?.pendingParts.includes(draft.part)) setDraft(null);
  if (draft?.kind === "items" && items.units === 0) setDraft(null);

  /** Reads the account again after a conflict (the socket usually brings it too). */
  async function refresh() {
    try {
      onUpdated(await tableSessionsApi.get(restaurantId, session.id));
    } catch (failure) {
      if (hasCode(failure, "TABLE_SESSION_NOT_FOUND")) onGone();
    }
  }

  function handleFailure(failure: unknown) {
    if (hasCode(failure, "TABLE_SESSION_NOT_FOUND")) {
      toast.info(errorMessage(failure));
      onGone();
      return;
    }
    setError(failure);
    if (hasCode(failure, "TABLE_OVERPAID")) setOverpaid(true);
    if (hasCode(failure, ...STALE_CODES)) void refresh();
  }

  async function savePlan(input: SetTableSplitInput) {
    setPlanPending(true);
    setError(null);
    try {
      onUpdated(await tableSessionsApi.setSplit(restaurantId, session.id, input));
    } catch (failure) {
      setMode(modeOfSplit(session.split));
      handleFailure(failure);
    } finally {
      setPlanPending(false);
    }
  }

  function chooseMode(next: ChargeMode) {
    if (next === mode || planPending) return;
    setMode(next);
    setDraft(null);
    setError(null);
    const input = splitInputFor(next, session.split);
    if (input) void savePlan(input);
  }

  /** Runs a payment (or the final charge); a closed answer means the bill is paid. */
  async function charge(run: () => Promise<TableSessionView>, amount: number) {
    setPending(true);
    setError(null);
    setOverpaid(false);
    try {
      const updated = await run();
      if (updated.status !== "open") {
        onClosed(updated);
        return;
      }
      onUpdated(updated);
      setDraft(null);
      setSelection({});
      setAmountText("");
      toast.success(`Pago registrado · ${money(amount)}`);
    } catch (failure) {
      handleFailure(failure);
    } finally {
      setPending(false);
    }
  }

  async function deletePayment(payment: TablePaymentView) {
    setDeletePending(true);
    try {
      onUpdated(await tableSessionsApi.deletePayment(restaurantId, session.id, payment.id));
      setOverpaid(false);
      setError(null);
      toast.success("Pago anulado");
    } catch (failure) {
      toast.error(errorMessage(failure));
      if (hasCode(failure, "TABLE_SESSION_NOT_FOUND")) onGone();
      else if (hasCode(failure, ...STALE_CODES)) void refresh();
    } finally {
      setDeletePending(false);
      setDeleting(null);
    }
  }

  if (empty) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Liberar {session.tableLabel}</DialogTitle>
          <DialogDescription>La mesa no tiene pedidos: se cierra la cuenta sin cobrar.</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <DialogFooter>
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={() => void charge(() => tableSessionsApi.close(restaurantId, session.id, { method: "cash", tip: 0 }), 0)}
            data-testid="confirm-charge"
          >
            Liberar mesa
          </Button>
        </DialogFooter>
      </>
    );
  }

  const free = amountFromInput(amountText, session.remaining, session.currency);
  const paidApart = session.subtotal - session.paid - session.remaining;

  /** The payment step of the current draft, or null while choosing what to charge. */
  function draftStep() {
    if (!draft) return null;
    if (draft.kind === "equal") {
      const amount = session.equalPart?.amount ?? 0;
      return (
        <PaymentStep
          key={`equal-${draft.part}`}
          session={session}
          title={`Parte ${draft.part} de ${session.split?.mode === "equal" ? session.split.parts : "?"}`}
          amount={amount}
          initialTip={suggestedPaymentTip(session, "equal", amount)}
          pending={pending}
          onBack={() => setDraft(null)}
          onConfirm={(method, tip) =>
            void charge(() => tableSessionsApi.addPayment(restaurantId, session.id, { kind: "equal", part: draft.part, method, tip }), amount)
          }
        />
      );
    }
    if (draft.kind === "items") {
      return (
        <PaymentStep
          key="items"
          session={session}
          title={unitsLabel(items.units)}
          amount={items.amount}
          initialTip={suggestedPaymentTip(session, "items", items.amount)}
          pending={pending}
          onBack={() => setDraft(null)}
          onConfirm={(method, tip) =>
            void charge(
              () => tableSessionsApi.addPayment(restaurantId, session.id, { kind: "items", items: items.items, method, tip }),
              items.amount,
            )
          }
        />
      );
    }
    return (
      <PaymentStep
        key={`amount-${draft.amount}`}
        session={session}
        title="Monto libre"
        amount={draft.amount}
        initialTip={suggestedPaymentTip(session, "amount", draft.amount)}
        pending={pending}
        onBack={() => setDraft(null)}
        onConfirm={(method, tip) =>
          void charge(() => tableSessionsApi.addPayment(restaurantId, session.id, { kind: "amount", amount: draft.amount, method, tip }), draft.amount)
        }
      />
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cobrar {session.tableLabel}</DialogTitle>
        <DialogDescription className="sr-only">Elige cómo pagan y registra cada pago con su medio y propina.</DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-3 gap-2 text-center" aria-label="Resumen de la cuenta">
        <div className="flex flex-col rounded-lg bg-muted px-2 py-2">
          <dt className="text-xs text-muted-foreground">Consumo</dt>
          <dd className="font-semibold tabular-nums" data-testid="charge-subtotal">
            {money(session.subtotal)}
          </dd>
        </div>
        <div className="flex flex-col rounded-lg bg-muted px-2 py-2">
          <dt className="text-xs text-muted-foreground">Pagado</dt>
          <dd className="font-semibold tabular-nums" data-testid="charge-paid">
            {money(session.paid)}
          </dd>
        </div>
        <div className="flex flex-col rounded-lg bg-brand-soft px-2 py-2 ring-1 ring-primary/30">
          <dt className="text-xs font-medium">Falta</dt>
          <dd className="text-lg font-bold tabular-nums" data-testid="charge-remaining">
            {money(session.remaining)}
          </dd>
        </div>
      </dl>
      {session.requestedTip !== null || paidApart > 0 || session.ordersInProgress > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {session.requestedTip !== null ? <li>La mesa pidió la cuenta con propina de {money(session.requestedTip)}.</li> : null}
          {paidApart > 0 ? <li>Pedidos pagados aparte: {money(paidApart)} (no entran en lo que falta).</li> : null}
          {session.ordersInProgress > 0 ? (
            <li className="font-medium text-foreground">
              {session.ordersInProgress === 1 ? "1 pedido está" : `${session.ordersInProgress} pedidos están`} en preparación: puedes cobrar
              partes, pero la cuenta se cierra cuando estén servidos.
            </li>
          ) : null}
        </ul>
      ) : null}

      <div role="radiogroup" aria-label="Forma de cobro" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:grid-cols-4">
        {CHARGE_MODES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            disabled={planPending || pending}
            onClick={() => chooseMode(option)}
            className={cn(
              "min-h-10 rounded-md px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
              mode === option ? "bg-background shadow-sm ring-1 ring-foreground/10" : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={`charge-mode-${option}`}
          >
            {CHARGE_MODE_LABELS[option]}
          </button>
        ))}
      </div>
      {planPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner aria-hidden /> Guardando la forma de pago…
        </p>
      ) : null}

      {draft ? (
        draftStep()
      ) : mode === "all" ? (
        <PaymentStep
          key={`all-${session.payments.length}`}
          session={session}
          title={session.payments.length > 0 ? "Lo que falta" : null}
          amount={session.remaining}
          initialTip={suggestedPaymentTip(session, "all", session.remaining)}
          pending={pending}
          confirmLabel={session.remaining > 0 ? "Cobrar y cerrar la cuenta" : "Cerrar la cuenta"}
          onConfirm={(method, tip) => void charge(() => tableSessionsApi.close(restaurantId, session.id, { method, tip }), session.remaining)}
        />
      ) : mode === "equal" ? (
        <EqualParts
          session={session}
          planPending={planPending}
          onParts={(parts) => void savePlan({ mode: "equal", parts })}
          onCharge={(part) => setDraft({ kind: "equal", part })}
          onDelete={setDeleting}
        />
      ) : mode === "items" ? (
        <section className="flex flex-col gap-2" aria-label="Pagar por productos">
          <p className="text-sm text-muted-foreground">Marca lo que paga esta persona.</p>
          <ul className="flex flex-col divide-y rounded-lg border">
            {session.itemLines.map((line) => {
              const key = itemLineKey(line);
              const left = unpaidUnits(line);
              const chosen = Math.min(selection[key] ?? 0, left);
              const checkboxId = `pick-${key}`;
              return (
                <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="split-item">
                  <Checkbox
                    id={checkboxId}
                    checked={chosen > 0}
                    disabled={left === 0 || pending}
                    onCheckedChange={(checked) => setSelection((current) => ({ ...current, [key]: checked === true ? left : 0 }))}
                  />
                  <label htmlFor={checkboxId} className={cn("flex min-w-0 flex-1 flex-col", left === 0 && "text-muted-foreground line-through")}>
                    <span className="text-sm font-medium">
                      {line.quantity} × {line.name}
                    </span>
                    {line.options.length > 0 ? <span className="text-xs text-muted-foreground">{line.options.join(" · ")}</span> : null}
                    {line.paidQuantity > 0 && left > 0 ? (
                      <span className="text-xs text-success">{line.paidQuantity} pagado</span>
                    ) : null}
                  </label>
                  <span className="text-sm tabular-nums">{left === 0 ? "Pagado" : money(line.total)}</span>
                  {chosen > 0 && left > 1 ? (
                    <QuantityStepper
                      size="sm"
                      className="ml-7"
                      label={`Unidades de ${line.name} a pagar`}
                      value={chosen}
                      min={1}
                      max={left}
                      onChange={(value) => setSelection((current) => ({ ...current, [key]: value }))}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm" data-testid="selection-total">
              {items.units > 0 ? (
                <>
                  {unitsLabel(items.units)} · <strong className="tabular-nums">{money(items.amount)}</strong>
                </>
              ) : (
                <span className="text-muted-foreground">Nada elegido</span>
              )}
            </span>
            <Button disabled={items.units === 0 || pending} onClick={() => setDraft({ kind: "items" })} data-testid="charge-selection">
              Cobrar selección
            </Button>
          </div>
        </section>
      ) : (
        <FreeAmount
          session={session}
          text={amountText}
          onText={setAmountText}
          problem={amountText.trim() === "" ? null : free.problem}
          disabled={free.amount === null || pending}
          onCharge={() => free.amount !== null && setDraft({ kind: "amount", amount: free.amount })}
        />
      )}

      <FormError error={error} />

      {session.payments.length > 0 ? (
        <section
          className={cn("flex flex-col gap-1 rounded-lg p-2 ring-1 ring-foreground/10", overpaid && "ring-2 ring-destructive")}
          aria-label="Pagos registrados"
          data-testid="payments-list"
        >
          <h3 className="px-1 text-sm font-semibold">Pagos registrados</h3>
          <ul className="flex flex-col divide-y">
            {session.payments.map((payment) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                money={money}
                detail={payment.kind === "items" ? paidItemsDetail(payment, session.itemLines) : null}
                disabled={pending || deletePending}
                onDelete={() => setDeleting(payment)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="¿Anular este pago?"
        description={
          deleting
            ? `${paymentKindLabel(deleting)} · ${PAYMENT_METHOD_LABELS[deleting.method]} · ${money(deleting.amount)}${deleting.tip > 0 ? ` (propina ${money(deleting.tip)})` : ""}. Vuelve a quedar por cobrar; devuelve el dinero si ya lo recibiste.`
            : ""
        }
        confirmLabel="Anular pago"
        destructive
        pending={deletePending}
        onConfirm={() => deleting && void deletePayment(deleting)}
      />
    </>
  );
}

function EqualParts({
  session,
  planPending,
  onParts,
  onCharge,
  onDelete,
}: {
  session: TableSessionView;
  planPending: boolean;
  onParts(parts: number): void;
  onCharge(part: number): void;
  onDelete(payment: TablePaymentView): void;
}) {
  const money = (amount: number) => formatPrice(amount, session.currency);
  if (session.split?.mode !== "equal") return null;
  const rows = equalPartRows(session);
  const next = session.equalPart?.amount ?? 0;
  return (
    <section className="flex flex-col gap-2" aria-label="Partes iguales">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Partes</span>
        <QuantityStepper
          label="Cantidad de partes"
          value={session.split.parts}
          min={minSplitParts(session.payments)}
          max={SPLIT_LIMITS.partsMax}
          disabled={planPending}
          onChange={onParts}
        />
      </div>
      <ul className="flex flex-col divide-y rounded-lg border">
        {rows.map((row) =>
          row.status === "paid" ? (
            <li key={row.part} className="flex items-center gap-3 px-3 py-2" data-testid="equal-part" data-status="paid">
              <CheckCircle2Icon className="size-5 shrink-0 text-success" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">
                  Parte {row.part} · {PAYMENT_METHOD_LABELS[row.payment.method]} · {money(row.payment.amount)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {row.payment.tip > 0 ? `Propina ${money(row.payment.tip)} · ` : ""}
                  {row.payment.byName ? `${row.payment.byName} · ` : ""}
                  {clock(row.payment.at)}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => onDelete(row.payment)} aria-label={`Anular el pago de la parte ${row.part}`}>
                <Undo2Icon aria-hidden data-icon="inline-start" />
                Anular
              </Button>
            </li>
          ) : (
            <li key={row.part} className="flex items-center gap-3 px-3 py-2" data-testid="equal-part" data-status="pending">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">Parte {row.part}</span>
                <span className="text-sm tabular-nums text-muted-foreground">{money(row.amount)}</span>
              </span>
              <Button size="sm" disabled={next <= 0 || planPending} onClick={() => onCharge(row.part)}>
                Cobrar parte {row.part}
              </Button>
            </li>
          ),
        )}
      </ul>
      {rows.some((row) => row.status === "pending") ? (
        <p className="text-xs text-muted-foreground">
          La parte que cobres ahora paga {money(next)}; la última pendiente se ajusta para que todo sume lo que falta.
        </p>
      ) : null}
    </section>
  );
}

function FreeAmount({
  session,
  text,
  onText,
  problem,
  disabled,
  onCharge,
}: {
  session: TableSessionView;
  text: string;
  onText(text: string): void;
  problem: string | null;
  disabled: boolean;
  onCharge(): void;
}) {
  const id = useId();
  return (
    <section className="flex flex-col gap-2" aria-label="Montos libres">
      <label htmlFor={`${id}-amount`} className="text-sm font-medium">
        Monto que paga esta persona
      </label>
      <div className="flex gap-2">
        <PriceInput
          id={`${id}-amount`}
          placeholder="5.000"
          value={text}
          onChange={(event) => onText(event.target.value)}
          aria-invalid={problem !== null || undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
        />
        <Button type="button" variant="outline" className="shrink-0" onClick={() => onText(formatPriceInput(session.remaining))} disabled={session.remaining <= 0}>
          Todo lo que falta
        </Button>
      </div>
      {problem ? (
        <p id={`${id}-problem`} className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <Button size="lg" disabled={disabled} onClick={onCharge} data-testid="charge-amount">
        Cobrar
      </Button>
    </section>
  );
}

function PaymentRow({
  payment,
  money,
  detail,
  disabled,
  onDelete,
}: {
  payment: TablePaymentView;
  money(amount: number): string;
  detail: string | null;
  disabled: boolean;
  onDelete(): void;
}) {
  return (
    <li className="flex items-center gap-3 px-1 py-2" data-testid="table-payment">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">
          {paymentKindLabel(payment)} · {PAYMENT_METHOD_LABELS[payment.method]} · <span className="tabular-nums">{money(payment.amount)}</span>
        </span>
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
        <span className="text-xs text-muted-foreground">
          {payment.tip > 0 ? `Propina ${money(payment.tip)} · ` : "Sin propina · "}
          {payment.byName ? `${payment.byName} · ` : ""}
          {clock(payment.at)}
        </span>
      </span>
      <Button size="sm" variant="ghost" disabled={disabled} onClick={onDelete} aria-label={`Anular ${paymentKindLabel(payment)} de ${money(payment.amount)}`}>
        <Undo2Icon aria-hidden data-icon="inline-start" />
        Anular
      </Button>
    </li>
  );
}

/**
 * One payment: its amount, the tip (suggested, editable, 0 allowed; voluntary) and the method. Used inline
 * by "Todo junto" and as the step after choosing a part, products or an amount.
 * @param title What is being charged ("Parte 2 de 4"); null hides the heading.
 */
function PaymentStep({
  session,
  title,
  amount,
  initialTip,
  pending,
  confirmLabel,
  onBack,
  onConfirm,
}: {
  session: TableSessionView;
  title: string | null;
  amount: number;
  initialTip: number;
  pending: boolean;
  confirmLabel?: string;
  onBack?(): void;
  onConfirm(method: PaymentMethod, tip: number): void;
}) {
  const id = useId();
  const money = (value: number) => formatPrice(value, session.currency);
  const [tipText, setTipText] = useState(() => formatPriceInput(initialTip));
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const tip = parseTip(tipText);
  const closes = amount >= session.remaining;
  const ready = method !== null && tip !== null && !pending;

  return (
    <section className="flex flex-col gap-3" aria-label={title ?? "Cobrar"} data-testid="payment-step">
      {title ? (
        <div className="flex items-baseline justify-between gap-2 border-b pb-2">
          <h3 className="font-semibold">{title}</h3>
          <span className="text-lg font-bold tabular-nums" data-testid="payment-amount">
            {money(amount)}
          </span>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-tip`} className="text-sm font-medium">
          Propina voluntaria{" "}
          {session.tipPercent > 0 ? <span className="font-normal text-muted-foreground">(sugerida {session.tipPercent} %)</span> : null}
        </label>
        <PriceInput id={`${id}-tip`} value={tipText} onChange={(event) => setTipText(event.target.value)} aria-invalid={tip === null || undefined} />
        {tip === null ? <p className="text-sm text-destructive">Escribe un monto válido, ej. 2.000</p> : null}
        <p className="text-sm">
          Total a cobrar:{" "}
          <strong className="tabular-nums" data-testid="charge-total">
            {money(amount + (tip ?? 0))}
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
      {closes && onBack ? <p className="text-xs text-muted-foreground">Este pago completa la cuenta y la cierra.</p> : null}
      <div className="flex gap-2">
        {onBack ? (
          <Button type="button" variant="outline" size="lg" onClick={onBack} disabled={pending}>
            Volver
          </Button>
        ) : null}
        <Button
          size="lg"
          className="flex-1"
          disabled={!ready}
          aria-busy={pending || undefined}
          onClick={() => method && tip !== null && onConfirm(method, tip)}
          data-testid="confirm-charge"
        >
          {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
          {confirmLabel ?? `Cobrar ${money(amount + (tip ?? 0))}`}
        </Button>
      </div>
    </section>
  );
}
