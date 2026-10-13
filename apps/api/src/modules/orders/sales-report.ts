import {
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type SalesExportKind,
  type SalesReport,
} from "@app/types";
import { summarizeDay } from "./daily-summary";
import type { OrderRecord } from "./orders.repository";

/** Orders that never happened (rejected, cancelled) are listed in exports but never summed. */
const counts = (order: OrderRecord) => order.status !== "rejected" && order.status !== "cancelled";

/** Regular − charged base price over the order's lines: the discounts given. */
export function orderDiscount(order: Pick<OrderRecord, "items">): number {
  return order.items.reduce((sum, item) => sum + (item.regularUnitPrice - item.unitPrice) * item.quantity, 0);
}

/** Every business day from..to (inclusive), YYYY-MM-DD. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Sales between two business days: the same figures as the daily summary over every order of the range,
 * plus one row per day (days without orders included, so a printed report shows them as zero).
 * @param tipsByDay Tips of the table accounts closed each business day.
 */
export function summarizeRange(
  orders: readonly OrderRecord[],
  from: string,
  to: string,
  currency: string,
  tipsByDay: ReadonlyMap<string, number>,
): SalesReport {
  const tips = [...tipsByDay.values()].reduce((a, b) => a + b, 0);
  const { date: _date, ...totals } = summarizeDay(orders, from, currency, tips);
  const byDay = new Map(daysBetween(from, to).map((date) => [date, { date, orders: 0, total: 0, tips: tipsByDay.get(date) ?? 0 }]));
  for (const order of orders) {
    const day = byDay.get(order.businessDate);
    if (!day || !counts(order)) continue;
    day.orders++;
    day.total += order.total;
  }
  return { ...totals, from, to, days: [...byDay.values()] };
}

// ── CSV (Excel in Spanish: ";" separator, UTF-8 with BOM) ───────────────────

const BOM = "﻿";

/**
 * One CSV field: quoted when it holds the separator, quotes or line breaks; text that a spreadsheet would
 * run as a formula (=, +, -, @ at the start) is prefixed with an apostrophe (CSV injection).
 */
export function csvField(value: string | number): string {
  if (typeof value === "number") return String(value);
  let text = value.replace(/\r?\n/g, " ");
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return /[;"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows: (string | number)[][]): string {
  return BOM + rows.map((row) => row.map(csvField).join(";")).join("\r\n") + "\r\n";
}

/** Date and time of an instant in the restaurant's timezone: ["12-10-2026", "20:45"]. */
function localDateTime(at: Date, timeZone: string): [string, string] {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return [`${get("day")}-${get("month")}-${get("year")}`, `${get("hour")}:${get("minute")}`];
}

/**
 * A sales export as CSV. Amounts are integers in the currency's minor unit (CLP: pesos), so spreadsheets
 * sum them without parsing formats.
 */
export function salesCsv(
  kind: SalesExportKind,
  orders: readonly OrderRecord[],
  report: SalesReport,
  timeZone: string,
): string {
  if (kind === "orders") {
    const rows: (string | number)[][] = [
      ["Fecha", "Hora", "N° pedido", "N° del día", "Canal", "Mesa o cliente", "Estado", "Pago", "Medio de pago", "Productos", "Descuentos", "Envío", "Total"],
    ];
    for (const order of [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const [date, time] = localDateTime(order.createdAt, timeZone);
      rows.push([
        date,
        time,
        order.number,
        order.ticketNumber,
        ORDER_CHANNEL_LABELS[order.channel],
        order.tableLabel ?? order.customerName,
        ORDER_STATUS_LABELS[order.status],
        order.paymentStatus === "paid" ? "Pagado" : "Pendiente",
        order.paymentMethod ? PAYMENT_METHOD_LABELS[order.paymentMethod] : "",
        order.items.reduce((sum, item) => sum + item.quantity, 0),
        orderDiscount(order),
        order.deliveryFee,
        counts(order) ? order.total : 0,
      ]);
    }
    return csv(rows);
  }

  if (kind === "products") {
    const products = new Map<string, { name: string; quantity: number; total: number; discounts: number }>();
    for (const order of orders) {
      if (!counts(order)) continue;
      for (const item of order.items) {
        const entry = products.get(item.productId) ?? { name: item.name, quantity: 0, total: 0, discounts: 0 };
        entry.name = item.name;
        entry.quantity += item.quantity;
        entry.total += item.lineTotal;
        entry.discounts += (item.regularUnitPrice - item.unitPrice) * item.quantity;
        products.set(item.productId, entry);
      }
    }
    const rows: (string | number)[][] = [["Producto", "Unidades", "Descuentos", "Total vendido"]];
    for (const p of [...products.values()].sort((a, b) => b.total - a.total)) rows.push([p.name, p.quantity, p.discounts, p.total]);
    return csv(rows);
  }

  const rows: (string | number)[][] = [["Fecha", "Pedidos", "Ventas", "Propinas"]];
  for (const day of report.days) {
    rows.push([`${day.date.slice(8, 10)}-${day.date.slice(5, 7)}-${day.date.slice(0, 4)}`, day.orders, day.total, day.tips]);
  }
  rows.push(["Total", report.days.reduce((s, d) => s + d.orders, 0), report.sales.total, report.tips]);
  return csv(rows);
}
