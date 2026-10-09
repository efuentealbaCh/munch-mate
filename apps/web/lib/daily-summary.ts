import {
  type DailySummary,
  ORDER_CHANNEL_LABELS,
  ORDER_CHANNELS,
  type OrderChannel,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type RestaurantRole,
} from "@app/types";

/** Helpers for the "Ventas" page (daily summary). Dates are business dates "YYYY-MM-DD" in the restaurant's zone. */

/** Owner and cashier can see the sales report (same roles the api allows). */
export function canViewSales(roles: readonly RestaurantRole[]): boolean {
  return roles.includes("owner") || roles.includes("cashier");
}

/**
 * Share of `part` in `total` as a whole percentage (0–100), for bar widths. 0 when there is no total.
 */
export function percentOf(part: number, total: number): number {
  if (total <= 0 || part <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 100));
}

export interface BreakdownRow<K extends string> {
  key: K;
  label: string;
  amount: number;
  /** Orders (channels only). */
  orders?: number;
  /** Width of the bar, relative to the sum of all rows. */
  percent: number;
}

/** Sales per channel, biggest first; channels without orders are left out. */
export function channelRows(summary: DailySummary): BreakdownRow<OrderChannel>[] {
  const sum = ORDER_CHANNELS.reduce((acc, channel) => acc + summary.byChannel[channel].total, 0);
  return ORDER_CHANNELS.filter((channel) => summary.byChannel[channel].orders > 0)
    .map((channel) => ({
      key: channel,
      label: ORDER_CHANNEL_LABELS[channel],
      amount: summary.byChannel[channel].total,
      orders: summary.byChannel[channel].orders,
      percent: percentOf(summary.byChannel[channel].total, sum),
    }))
    .sort((a, b) => b.amount - a.amount);
}

/** Paid amounts per payment method, biggest first; methods without payments are left out. */
export function paymentRows(summary: DailySummary): BreakdownRow<PaymentMethod>[] {
  const sum = PAYMENT_METHODS.reduce((acc, method) => acc + summary.byPaymentMethod[method], 0);
  return PAYMENT_METHODS.filter((method) => summary.byPaymentMethod[method] > 0)
    .map((method) => ({
      key: method,
      label: PAYMENT_METHOD_LABELS[method],
      amount: summary.byPaymentMethod[method],
      percent: percentOf(summary.byPaymentMethod[method], sum),
    }))
    .sort((a, b) => b.amount - a.amount);
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Moves a business date by whole days ("2026-03-01", -1 → "2026-02-28"). Done in UTC: these are calendar
 * dates, not instants, so DST must not shift them.
 */
export function shiftDate(date: string, days: number): string {
  const match = DATE.exec(date);
  if (!match) return date;
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return utc.toISOString().slice(0, 10);
}

/** Today's business date in a time zone ("YYYY-MM-DD"), the same day the api uses when `date` is omitted. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const longDate = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** "Hoy", "Ayer" or "lunes 5 de octubre" for a business date, relative to `today`. */
export function businessDateLabel(date: string, today: string): string {
  if (date === today) return "Hoy";
  if (date === shiftDate(today, -1)) return "Ayer";
  const match = DATE.exec(date);
  if (!match) return date;
  return longDate.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

/** Orders that count as sales: completed plus in progress (rejected and cancelled do not). */
export function countedOrders(summary: DailySummary): number {
  return summary.orders.completed + summary.orders.inProgress;
}
