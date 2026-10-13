import {
  ORDER_CHANNEL_LABELS,
  PAYMENT_METHOD_LABELS,
  type OrderView,
  type TableSessionView,
} from "@app/types";
import type { KeyValueStorage } from "./cart";
import { formatPrice } from "./money";

/**
 * Thermal printing (phase 8): kitchen tickets ("comandas") and table pre-bills, printed by the browser on a
 * 58 or 80 mm receipt printer installed in the device (USB, Bluetooth or network, through its driver).
 * Each device chooses its paper and whether it prints new orders by itself: only the kitchen tablet should.
 */

export const PAPER_WIDTHS = ["58", "80"] as const;
export type PaperWidth = (typeof PAPER_WIDTHS)[number];

/** off: only the print buttons. new: every new order. accepted: when an order is accepted (any device). */
export const AUTO_PRINT_MODES = ["off", "new", "accepted"] as const;
export type AutoPrintMode = (typeof AUTO_PRINT_MODES)[number];

export const AUTO_PRINT_LABELS: Record<AutoPrintMode, string> = {
  off: "No, solo con el botón",
  new: "Cada pedido nuevo",
  accepted: "Cada pedido al aceptarlo",
};

export interface PrintSettings {
  paper: PaperWidth;
  auto: AutoPrintMode;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = { paper: "80", auto: "off" };
const STORAGE_KEY = "mm:print-settings";

/** This device's printing settings (per restaurant: a device may serve two kitchens). */
export function loadPrintSettings(storage: KeyValueStorage | undefined, restaurantId: string): PrintSettings {
  try {
    const raw = storage?.getItem(`${STORAGE_KEY}:${restaurantId}`);
    const parsed = raw ? (JSON.parse(raw) as Partial<PrintSettings>) : {};
    return {
      paper: PAPER_WIDTHS.includes(parsed.paper as PaperWidth) ? (parsed.paper as PaperWidth) : DEFAULT_PRINT_SETTINGS.paper,
      auto: AUTO_PRINT_MODES.includes(parsed.auto as AutoPrintMode) ? (parsed.auto as AutoPrintMode) : DEFAULT_PRINT_SETTINGS.auto,
    };
  } catch {
    return DEFAULT_PRINT_SETTINGS;
  }
}

export function savePrintSettings(storage: KeyValueStorage | undefined, restaurantId: string, settings: PrintSettings): void {
  try {
    storage?.setItem(`${STORAGE_KEY}:${restaurantId}`, JSON.stringify(settings));
  } catch {
    // Private mode or full storage: the settings last until the page closes.
  }
}

/**
 * Whether this device prints an order by itself.
 * @param event "created": a new order arrived. "updated": an order changed (`previous` = what the board had).
 */
export function shouldAutoPrint(
  mode: AutoPrintMode,
  event: "created" | "updated",
  order: Pick<OrderView, "status">,
  previous?: Pick<OrderView, "status"> | null,
): boolean {
  if (mode === "new") return event === "created";
  if (mode === "accepted") return event === "updated" && order.status === "accepted" && previous?.status !== "accepted";
  return false;
}

/**
 * Whether this device prints the kitchen ticket again because the staff edited the order's items: only a
 * device that prints by itself (any mode but "off") and already printed this order (the kitchen has the old
 * ticket), and only when the order is at a newer revision than that ticket.
 * @param printedBefore This device printed the order earlier (manually or by itself).
 * @param previousRevision `revision` of the last ticket printed here (null: unknown). Comparing with the printed
 *   ticket, rather than with the board's previous copy, prints each edit once even when the socket echo of an
 *   edit made on this device arrives before the api's answer.
 */
export function shouldReprintEdited(
  mode: AutoPrintMode,
  printedBefore: boolean,
  previousRevision: number | null,
  order: Pick<OrderView, "revision">,
): boolean {
  return mode !== "off" && printedBefore && previousRevision !== null && order.revision > previousRevision;
}

// ── What a ticket says ──────────────────────────────────────────────────────

export interface TicketLine {
  quantity: number;
  name: string;
  /** Options and notes, one per row. */
  details: string[];
  /** Amount on the right (pre-bills); kitchen tickets have none. */
  amount?: string;
}

export interface Ticket {
  /** Framed word above everything, for the kitchen to notice ("MODIFICADO"). */
  banner?: string;
  /** Big text at the top: "#12" or "Mesa 4". */
  headline: string;
  title: string;
  /** Small rows under the title: channel, table or customer, time. */
  meta: string[];
  lines: TicketLine[];
  totals: { label: string; amount: string; strong?: boolean }[];
  /** What changed in the last edit, under the lines (edited kitchen tickets). */
  changes?: { title: string; rows: string[] };
  footer: string[];
}

const time = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });

/**
 * Kitchen ticket: what to prepare, without prices. An order whose items the staff edited says "MODIFICADO"
 * in a frame at the top, lists the whole updated order and, under it, the changes of the last edit (with its
 * reason), so the kitchen can swap the old ticket.
 */
export function kitchenTicket(order: OrderView, restaurantName: string, timeZone?: string): Ticket {
  const where =
    order.channel === "dine_in"
      ? (order.tableLabel ?? "Mesa")
      : order.channel === "delivery"
        ? `Delivery · ${order.customerName}`
        : `Retiro · ${order.customerName}`;
  const meta = [`${ORDER_CHANNEL_LABELS[order.channel]} · ${time(order.createdAt, timeZone)}`, where];
  if (order.estimatedReadyAt) {
    meta.push(`${order.channel === "delivery" ? "Llega" : "Listo"} aprox. ${time(order.estimatedReadyAt, timeZone)}`);
  }
  const lastEdit = order.edits.at(-1);
  return {
    ...(lastEdit ? { banner: "MODIFICADO" } : {}),
    headline: `#${order.ticketNumber}`,
    title: restaurantName,
    meta,
    lines: order.items.map((item) => ({
      quantity: item.quantity,
      name: item.name,
      details: [
        ...item.modifiers.map((m) => `${m.groupName}: ${m.optionName}`),
        ...(item.note ? [`Nota: ${item.note}`] : []),
      ],
    })),
    totals: [],
    ...(lastEdit
      ? {
          changes: {
            title: `Cambios ${time(lastEdit.at, timeZone)}${lastEdit.byName ? ` · ${lastEdit.byName}` : ""}:`,
            rows: [...lastEdit.changes, ...(lastEdit.reason ? [`Motivo: ${lastEdit.reason}`] : [])],
          },
        }
      : {}),
    footer: order.note ? [`Comentario: ${order.note}`] : [],
  };
}

/**
 * Table pre-bill ("precuenta"): the account with the suggested tip, stated as voluntary (Ley 20.918) and the
 * total with and without it. Uses the tip the customer chose when they asked for the bill, if any.
 */
export function preBillTicket(session: TableSessionView, restaurantName: string, at: Date = new Date()): Ticket {
  const money = (amount: number) => formatPrice(amount, session.currency);
  const tip = session.requestedTip ?? session.suggestedTip;
  const totals: Ticket["totals"] = [{ label: "Consumo", amount: money(session.subtotal) }];
  if (session.tipPercent > 0 || tip > 0) {
    totals.push({
      label: session.requestedTip !== null ? "Propina" : `Propina sugerida ${session.tipPercent} %`,
      amount: money(tip),
    });
    totals.push({ label: "Total con propina", amount: money(session.subtotal + tip), strong: true });
    totals.push({ label: "Total sin propina", amount: money(session.subtotal) });
  } else {
    totals.push({ label: "Total", amount: money(session.subtotal), strong: true });
  }
  return {
    headline: session.tableLabel,
    title: restaurantName,
    meta: [`Precuenta · ${at.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short", hourCycle: "h23" })}`],
    lines: session.lines.map((line) => ({ quantity: line.quantity, name: line.name, details: line.options, amount: money(line.total) })),
    totals,
    footer: [
      "La propina es voluntaria.",
      ...(session.paymentMethod ? [`Pagado: ${PAYMENT_METHOD_LABELS[session.paymentMethod]}`] : []),
      "Documento no válido como boleta.",
    ],
  };
}
