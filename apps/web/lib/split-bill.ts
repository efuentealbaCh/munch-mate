import {
  type BillItemLine,
  type EqualPartView,
  type OrderView,
  PAYMENT_METHOD_LABELS,
  type PublicTablePayment,
  type SetTableSplitInput,
  SPLIT_LIMITS,
  type TablePaymentItem,
  type TablePaymentView,
  type TableSessionView,
  type TableSplit,
} from "@app/types";
import { equalPartAmount, equalSplitState, suggestedTip } from "@app/utils";
import { formatPrice, parsePriceInput } from "./money";

/**
 * Split table accounts (phase 8) on the web: the charge dialog of «Salón», the pre-bill and the table's
 * phone. The amounts the api charges come from `@app/utils` (`equalPartAmount`, `equalSplitState`,
 * `suggestedTip`); these helpers only arrange them for the screen.
 */

/** How the waiter charges in the dialog: "all" = one payment for what is left (`close`), the rest = a plan. */
export type ChargeMode = "all" | "equal" | "items" | "amounts";

export const CHARGE_MODES: readonly ChargeMode[] = ["all", "equal", "items", "amounts"];

export const CHARGE_MODE_LABELS: Record<ChargeMode, string> = {
  all: "Todo junto",
  equal: "Partes iguales",
  items: "Por productos",
  amounts: "Montos libres",
};

/** The mode that shows an account's plan (no plan: "Todo junto"). */
export function modeOfSplit(split: TableSplit | null): ChargeMode {
  return split === null ? "all" : split.mode;
}

/**
 * The plan to save when the waiter picks a mode, or null when nothing has to change (the account already
 * has it). "Todo junto" removes a plan; "Partes iguales" keeps the parts of an equal plan, else starts with 2.
 */
export function splitInputFor(mode: ChargeMode, current: TableSplit | null): SetTableSplitInput | null {
  if (mode === "all") return current === null ? null : { mode: null };
  if (current?.mode === mode) return null;
  if (mode === "equal") return { mode: "equal", parts: SPLIT_LIMITS.partsMin };
  return { mode };
}

/** Equal parts already paid (payments of kind "equal"), as the api counts them for `SPLIT_PARTS_PAID`. */
function equalPayments(payments: readonly TablePaymentView[]): TablePaymentView[] {
  return payments.filter((payment) => payment.kind === "equal" && payment.part !== null);
}

/**
 * The fewest parts an equal plan may be changed to, as the api allows it: at least 2, more than the parts
 * already paid, and never below the highest part paid ("Parte 4" must stay inside the plan).
 */
export function minSplitParts(payments: readonly TablePaymentView[]): number {
  const paid = equalPayments(payments);
  return Math.max(SPLIT_LIMITS.partsMin, paid.length + 1, ...paid.map((payment) => payment.part!));
}

export type EqualPartRow =
  | { part: number; status: "paid"; payment: TablePaymentView }
  /** `amount`: what it would pay if the pending parts were charged in order (the last one takes the rest). */
  | { part: number; status: "pending"; amount: number };

/**
 * The rows of an equal split, part 1 to N: the paid ones with their payment, the pending ones with their
 * amount. Whichever pending part is charged next pays `equalPart.amount` (the api's amount); the preview
 * spreads what is left over the pending parts in order, so the last one shows the rounding difference.
 * @returns [] when the account is not split in equal parts.
 */
export function equalPartRows(session: Pick<TableSessionView, "split" | "payments" | "remaining">): EqualPartRow[] {
  const split = session.split;
  if (split?.mode !== "equal") return [];
  const paidByPart = new Map(equalPayments(session.payments).map((payment) => [payment.part!, payment]));
  const state = equalSplitState(session.remaining, split.parts, [...paidByPart.keys()]);
  const paidCount = split.parts - state.pendingParts.length;
  let left = session.remaining;
  const pendingAmounts = new Map<number, number>();
  state.pendingParts.forEach((part, index) => {
    const amount = equalPartAmount(left, split.parts, paidCount + index);
    pendingAmounts.set(part, amount);
    left -= amount;
  });
  return Array.from({ length: split.parts }, (_, i) => i + 1).map((part): EqualPartRow => {
    const payment = paidByPart.get(part);
    return payment ? { part, status: "paid", payment } : { part, status: "pending", amount: pendingAmounts.get(part) ?? 0 };
  });
}

// ── Pay by products ─────────────────────────────────────────────────────────

/** Key of one line of one order in a selection. */
export const itemLineKey = (line: Pick<BillItemLine, "orderId" | "line">): string => `${line.orderId}:${line.line}`;

/** Units of a line nobody paid yet. */
export const unpaidUnits = (line: Pick<BillItemLine, "quantity" | "paidQuantity">): number =>
  Math.max(0, line.quantity - line.paidQuantity);

/** Units chosen per line (`itemLineKey`). */
export type ItemSelection = Readonly<Record<string, number>>;

/**
 * What a "pay by products" selection pays, against the current lines: units above what is left unpaid are
 * capped (another waiter charged some meanwhile) and lines no longer on the account are dropped. The amount
 * rounds each line like the api (`itemsAmount`).
 */
export function selectionSummary(
  lines: readonly BillItemLine[],
  selection: ItemSelection,
): { items: TablePaymentItem[]; units: number; amount: number } {
  const items: TablePaymentItem[] = [];
  let units = 0;
  let amount = 0;
  for (const line of lines) {
    const quantity = Math.min(selection[itemLineKey(line)] ?? 0, unpaidUnits(line));
    if (quantity <= 0) continue;
    items.push({ orderId: line.orderId, line: line.line, quantity });
    units += quantity;
    amount += Math.round(line.unitAmount * quantity);
  }
  return { items, units, amount };
}

/** "1 producto" / "3 productos". */
export function unitsLabel(units: number): string {
  return `${units} ${units === 1 ? "producto" : "productos"}`;
}

/**
 * What a "pay by products" payment covered, for the staff: "2 × Lasaña, 1 × Bebida". Lines no longer on the
 * account (an order cancelled after paying) are left out.
 */
export function paidItemsDetail(payment: Pick<TablePaymentView, "items">, lines: readonly BillItemLine[]): string {
  const byKey = new Map(lines.map((line) => [itemLineKey(line), line]));
  return payment.items
    .map((item) => {
      const line = byKey.get(itemLineKey(item));
      return line ? `${item.quantity} × ${line.name}` : null;
    })
    .filter((text): text is string => text !== null)
    .join(", ");
}

// ── Free amounts ────────────────────────────────────────────────────────────

/**
 * The amount typed for a free payment ("5.000"): a whole amount from 1 to what is left (the api answers
 * `PAYMENT_EXCEEDS_BALANCE` above it).
 */
export function amountFromInput(
  text: string,
  remaining: number,
  currency: string,
): { amount: number; problem: null } | { amount: null; problem: string } {
  if (text.trim() === "") return { amount: null, problem: "Escribe el monto" };
  const amount = parsePriceInput(text);
  if (amount === null) return { amount: null, problem: "Escribe un monto válido, ej. 5.000" };
  if (amount < 1) return { amount: null, problem: "El monto debe ser mayor que $0" };
  if (amount > remaining) return { amount: null, problem: `No puede superar lo que falta (${formatPrice(remaining, currency)})` };
  return { amount, problem: null };
}

// ── Tips ────────────────────────────────────────────────────────────────────

type TipSession = Pick<TableSessionView, "requestedTip" | "suggestedTip" | "tipPercent" | "remaining" | "payments" | "split">;

const tipsOf = (payments: readonly Pick<TablePaymentView, "tip">[]) => payments.reduce((sum, payment) => sum + payment.tip, 0);

/**
 * The tip to start a payment with (the waiter confirms or changes it; it is voluntary).
 * - "all" (what is left): the tip the table chose minus the tips already charged, or the suggested % of what
 *   is left; with no payments yet, the table's choice or the suggestion on the whole bill (as before splits).
 * - "equal": the table's chosen tip, still uncharged, spread over the pending parts like the amounts.
 * - otherwise: the suggested % of the payment's amount.
 */
export function suggestedPaymentTip(session: TipSession, kind: "all" | "equal" | "items" | "amount", amount: number): number {
  if (kind === "all") {
    if (session.payments.length === 0) return session.requestedTip ?? session.suggestedTip;
    return session.requestedTip !== null
      ? Math.max(0, session.requestedTip - tipsOf(session.payments))
      : suggestedTip(session.remaining, session.tipPercent);
  }
  if (kind === "equal" && session.requestedTip !== null && session.split?.mode === "equal") {
    const paidParts = equalPayments(session.payments);
    const state = equalSplitState(session.remaining, session.split.parts, paidParts.map((p) => p.part!));
    const tipLeft = Math.max(0, session.requestedTip - tipsOf(paidParts));
    return equalPartAmount(tipLeft, session.split.parts, session.split.parts - state.pendingParts.length);
  }
  return suggestedTip(amount, session.tipPercent);
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** "Parte 2" / "3 productos" / "Pago": what a payment was, without the method. */
export function paymentKindLabel(payment: Pick<PublicTablePayment, "kind" | "part" | "itemCount">): string {
  if (payment.kind === "equal") return `Parte ${payment.part ?? "?"}`;
  if (payment.kind === "items") return unitsLabel(payment.itemCount);
  return "Pago";
}

/** A payment as the phones at the table list it: "Parte 1 · Efectivo · $12.000" (no names, no tips). */
export function publicPaymentLabel(payment: PublicTablePayment, currency: string): string {
  return `${paymentKindLabel(payment)} · ${PAYMENT_METHOD_LABELS[payment.method]} · ${formatPrice(payment.amount, currency)}`;
}

/** The plan as a short chip on the floor: "4 partes" / "Por productos" / "Montos libres"; null without plan. */
export function splitChipLabel(split: TableSplit | null): string | null {
  if (split === null) return null;
  if (split.mode === "equal") return `${split.parts} partes`;
  return CHARGE_MODE_LABELS[split.mode];
}

/**
 * The plan as the table's phone states it: "Dividida en 4 partes de $5.000" (the next part's amount while
 * some are pending), "Por productos", "Montos libres"; null without plan.
 */
export function splitPlanLabel(split: TableSplit | null, equalPart: EqualPartView | null, currency: string): string | null {
  if (split === null) return null;
  if (split.mode === "equal") {
    return equalPart && equalPart.amount > 0
      ? `Dividida en ${split.parts} partes de ${formatPrice(equalPart.amount, currency)}`
      : `Dividida en ${split.parts} partes`;
  }
  return split.mode === "items" ? "Dividida por productos" : "Dividida en montos libres";
}

const listFormat = new Intl.ListFormat("es", { style: "long", type: "conjunction" });

/** "Faltan las partes 3 y 4 de $5.000" / "Falta la parte 4 de $5.001"; null when none is pending. */
export function pendingPartsLabel(equalPart: EqualPartView | null, currency: string): string | null {
  if (!equalPart || equalPart.pendingParts.length === 0 || equalPart.amount <= 0) return null;
  const amount = formatPrice(equalPart.amount, currency);
  const parts = equalPart.pendingParts;
  return parts.length === 1
    ? `Falta la parte ${parts[0]} de ${amount}`
    : `Faltan las partes ${listFormat.format(parts.map(String))} de ${amount}`;
}

/** "1 de 2 pagado" for a line partly paid; null when none or all of it is paid. */
export function linePaidLabel(line: Pick<BillItemLine, "quantity" | "paidQuantity">): string | null {
  return line.paidQuantity > 0 && line.paidQuantity < line.quantity ? `${line.paidQuantity} de ${line.quantity} pagado` : null;
}

/**
 * How an order was paid, for its badge on the board: "Pagado · Efectivo", or for an order of a split table
 * account paid with several methods "Pagado · Dividido (Efectivo $8.000 · Tarjeta (POS) $4.000)".
 */
export function paymentBadgeLabel(order: Pick<OrderView, "paymentMethod" | "paymentBreakdown" | "currency">): string {
  if (order.paymentBreakdown.length > 1) {
    const portions = order.paymentBreakdown.map(
      (portion) => `${PAYMENT_METHOD_LABELS[portion.method]} ${formatPrice(portion.amount, order.currency)}`,
    );
    return `Pagado · Dividido (${portions.join(" · ")})`;
  }
  return `Pagado${order.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[order.paymentMethod]}` : ""}`;
}
