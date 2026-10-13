import {
  ORDER_CHANNEL_LABELS,
  type OrderView,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type PrintLayout,
  type PrintLine,
  type PrintPaper,
  type TablePaymentKind,
} from "@app/types";
import { formatMoney } from "./money";

/**
 * Printed tickets (phase 8): what a ticket says (`Ticket`, built by `kitchenTicket` and
 * `paymentReceiptTicket`) and how it is laid out on a receipt printer's columns (`layoutTicket`). Shared by
 * the web (browser printing renders `Ticket` as HTML) and the api (the print agent gets the layout rows and
 * only converts them to ESC/POS).
 */

// ── What a ticket says ──────────────────────────────────────────────────────

export interface TicketLine {
  quantity: number;
  name: string;
  /** Options and notes, one per row. */
  details: string[];
  /** Amount on the right (pre-bills, receipts); kitchen tickets have none. */
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

/** Legend of every payment receipt: the platform does not issue tax documents (SII). */
export const RECEIPT_LEGEND = "Comprobante interno, no válido como boleta";

const time = (iso: string | Date, timeZone?: string) =>
  new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });

const dateTime = (iso: string | Date, timeZone?: string) =>
  new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short", hourCycle: "h23", timeZone });

/** Options of `kitchenTicket` for printers that only print some menu categories (drinks → bar). */
export interface KitchenTicketOptions {
  /** Categories this printer prints; empty or absent = every category. */
  categoryIds?: ReadonlySet<string>;
  /** Current category of each product id. Items whose product is not in it (deleted) print everywhere. */
  productCategory?: ReadonlyMap<string, string>;
}

/**
 * Kitchen ticket: what to prepare, without prices. An order whose items the staff edited says "MODIFICADO"
 * in a frame at the top, lists the whole updated order and, under it, the changes of the last edit (with its
 * reason), so the kitchen can swap the old ticket.
 * With `options.categoryIds`, only the items of those categories are listed (the footer says how many units
 * print elsewhere); the ticket may end up with no lines, and callers decide whether to print it.
 */
export function kitchenTicket(
  order: OrderView,
  restaurantName: string,
  timeZone?: string,
  options: KitchenTicketOptions = {},
): Ticket {
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
  const filter = options.categoryIds && options.categoryIds.size > 0 ? options.categoryIds : null;
  const printsHere = (productId: string) => {
    if (!filter) return true;
    const category = options.productCategory?.get(productId);
    return category === undefined || filter.has(category);
  };
  const items = order.items.filter((item) => printsHere(item.productId));
  const elsewhere = order.items.filter((item) => !printsHere(item.productId)).reduce((sum, item) => sum + item.quantity, 0);
  const lastEdit = order.edits.at(-1);
  const footer = [
    ...(order.note ? [`Comentario: ${order.note}`] : []),
    ...(elsewhere > 0
      ? [`${elsewhere} ${elsewhere === 1 ? "producto más sale" : "productos más salen"} en otra impresora`]
      : []),
  ];
  return {
    ...(lastEdit ? { banner: "MODIFICADO" } : {}),
    headline: `#${order.ticketNumber}`,
    title: restaurantName,
    meta,
    lines: items.map((item) => ({
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
    footer,
  };
}

/** Fields every payment receipt needs. */
interface ReceiptBase {
  restaurantName: string;
  timeZone?: string;
  currency: string;
  /** When the payment was registered. */
  at: string | Date;
  /** Staff member who registered it. */
  byName: string | null;
  method: PaymentMethod;
}

/** A line paid by a "pay by products" payment, with the amount of the units paid. */
export interface ReceiptItem {
  quantity: number;
  name: string;
  details: string[];
  /** Minor units. */
  amount: number;
}

/** One payment of a table account (an equal part, some products, a free amount, or what was left). */
export interface TablePaymentReceiptInput extends ReceiptBase {
  kind: "table";
  tableLabel: string;
  payment: {
    kind: TablePaymentKind;
    /** Equal parts: which part (1-based) and of how many. */
    part: number | null;
    parts: number | null;
    /** Without the tip. */
    amount: number;
    tip: number;
    /** "Pay by products": the lines paid. */
    items: ReceiptItem[];
  };
  /** The account right after this payment (tips apart). */
  account: { total: number; paid: number; remaining: number; closed: boolean };
}

/** An order paid on its own (pickup, delivery, or a table order before its account had payments). */
export interface OrderPaymentReceiptInput extends ReceiptBase {
  kind: "order";
  order: Pick<
    OrderView,
    "ticketNumber" | "number" | "channel" | "tableLabel" | "customerName" | "items" | "subtotal" | "deliveryFee" | "total"
  >;
}

export type PaymentReceiptInput = TablePaymentReceiptInput | OrderPaymentReceiptInput;

/** How a table payment reads on its receipt: "Parte 2 de 4", "3 productos", "Pago". */
function tablePaymentLabel(payment: TablePaymentReceiptInput["payment"]): string {
  if (payment.kind === "equal") return payment.parts ? `Parte ${payment.part ?? "?"} de ${payment.parts}` : `Parte ${payment.part ?? "?"}`;
  if (payment.kind === "items") {
    const units = payment.items.reduce((sum, item) => sum + item.quantity, 0);
    return units === 1 ? "1 producto" : `${units} productos`;
  }
  return "Pago";
}

/**
 * Payment receipt ("comprobante de pago"): one ticket per payment, never a tax document (`RECEIPT_LEGEND`).
 * - Table payment: the table, what this payment covers (part, products or amount), method, amount, tip, total
 *   charged, and how the account stands (paid / left), with who registered it and when.
 * - Order paid on its own: ticket number, channel, its items, total and method.
 */
export function paymentReceiptTicket(input: PaymentReceiptInput): Ticket {
  const money = (amount: number) => formatMoney(amount, input.currency);
  const meta = [`Comprobante de pago · ${dateTime(input.at, input.timeZone)}`];
  const footer = [RECEIPT_LEGEND];
  if (input.kind === "table") {
    const { payment, account } = input;
    if (input.byName) meta.push(`Atendió: ${input.byName}`);
    const totals: Ticket["totals"] = [{ label: tablePaymentLabel(payment), amount: money(payment.amount) }];
    if (payment.tip > 0) totals.push({ label: "Propina", amount: money(payment.tip) });
    totals.push({ label: "Total cobrado", amount: money(payment.amount + payment.tip), strong: true });
    totals.push({ label: "Medio de pago", amount: PAYMENT_METHOD_LABELS[input.method] });
    totals.push({ label: "Total de la mesa", amount: money(account.total) });
    totals.push({ label: "Pagado", amount: money(account.paid) });
    totals.push(
      account.closed || account.remaining <= 0
        ? { label: "Cuenta pagada", amount: money(0), strong: true }
        : { label: "Falta", amount: money(account.remaining), strong: true },
    );
    if (payment.tip > 0) footer.unshift("La propina es voluntaria y no es parte de la venta.");
    return {
      headline: input.tableLabel,
      title: input.restaurantName,
      meta,
      lines: payment.items.map((item) => ({
        quantity: item.quantity,
        name: item.name,
        details: item.details,
        amount: money(item.amount),
      })),
      totals,
      footer,
    };
  }
  const { order } = input;
  meta.push(`${ORDER_CHANNEL_LABELS[order.channel]} · Pedido N° ${order.number}`);
  const who = order.channel === "dine_in" ? order.tableLabel : order.customerName;
  if (who) meta.push(who);
  if (input.byName) meta.push(`Cobró: ${input.byName}`);
  const totals: Ticket["totals"] = [];
  if (order.deliveryFee > 0) {
    totals.push({ label: "Subtotal", amount: money(order.subtotal) });
    totals.push({ label: "Despacho", amount: money(order.deliveryFee) });
  }
  totals.push({ label: "Total", amount: money(order.total), strong: true });
  totals.push({ label: "Medio de pago", amount: PAYMENT_METHOD_LABELS[input.method] });
  return {
    headline: `#${order.ticketNumber}`,
    title: input.restaurantName,
    meta,
    lines: order.items.map((item) => ({
      quantity: item.quantity,
      name: item.name,
      details: item.modifiers.map((m) => `${m.groupName}: ${m.optionName}`),
      amount: money(item.lineTotal),
    })),
    totals,
    footer,
  };
}

/**
 * Test page of a printer: its name and paper, a long item that must wrap, an amount at the right edge and
 * Spanish characters, so the owner sees at a glance whether the paper and the code page are right.
 */
export function testTicket(restaurantName: string, printerName: string, paper: PrintPaper, at: string | Date, timeZone?: string): Ticket {
  return {
    headline: "Prueba",
    title: restaurantName,
    meta: [`Impresora: ${printerName}`, `Papel ${paper} mm · ${ticketColumns(paper)} columnas`, dateTime(at, timeZone)],
    lines: [
      { quantity: 2, name: "Producto de ejemplo con un nombre largo que ocupa dos líneas", details: ["Tamaño: Grande", "Nota: sin cebolla"], amount: formatMoney(25980) },
    ],
    totals: [{ label: "Total", amount: formatMoney(25980), strong: true }],
    footer: ["Si ves bien las tildes y la eñe (á é í ó ú ñ ¿ ¡), la impresora quedó lista."],
  };
}

// ── Layout on a receipt printer ─────────────────────────────────────────────

/** Characters per row of the printer's normal font: 32 on 58 mm paper, 48 on 80 mm. */
export function ticketColumns(paper: PrintPaper): number {
  return paper === "58" ? 32 : 48;
}

/** Characters most receipt printers lack, with plain replacements (the width must be known here). */
const REPLACEMENTS: [RegExp, string][] = [
  [/[\t\r\n]+/g, " "],
  // No-break and figure spaces (currency formats use them).
  [/[\u00a0\u202f\u2007]/g, " "],
  [/[\u2192\u27f6\u2794]/g, "->"],
  [/\u2190/g, "<-"],
  [/[\u2212\u2013\u2014]/g, "-"],
  [/[\u201c\u201d\u201e\u00ab\u00bb]/g, '"'],
  [/[\u2018\u2019\u201a]/g, "'"],
  [/\u2026/g, "..."],
];

/**
 * Text as it can be printed: NFC (an accent is one character), invisible and control characters removed,
 * typographic symbols the printer code pages lack replaced ("3 → 2" becomes "3 -> 2").
 */
export function printableText(text: string): string {
  let result = text.normalize("NFC");
  for (const [pattern, replacement] of REPLACEMENTS) result = result.replace(pattern, replacement);
  return result.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, "");
}

/** Characters as the printer counts them (code points, not UTF-16 units). */
const width = (text: string) => Array.from(text).length;

/**
 * Splits text into rows of at most `columns` characters, at spaces; a word longer than a row is cut.
 * @returns [] for blank text.
 */
export function wrapText(text: string, columns: number): string[] {
  const size = Math.max(1, columns);
  const rows: string[] = [];
  let current = "";
  for (const word of printableText(text).split(" ").filter(Boolean)) {
    let rest = Array.from(word);
    if (current && width(current) + 1 + rest.length <= size) {
      current += ` ${word}`;
      continue;
    }
    if (current) rows.push(current);
    current = "";
    while (rest.length > size) {
      rows.push(rest.slice(0, size).join(""));
      rest = rest.slice(size);
    }
    current = rest.join("");
  }
  if (current) rows.push(current);
  return rows;
}

const line = (text: string, style: Partial<Omit<PrintLine, "text">> = {}): PrintLine => ({
  text,
  align: style.align ?? "left",
  bold: style.bold ?? false,
  size: style.size ?? 1,
});

/** `left` and `right` on one row of `columns` characters, the gap filled with spaces. */
function spread(left: string, right: string, columns: number): string {
  return `${left}${" ".repeat(Math.max(1, columns - width(left) - width(right)))}${right}`;
}

/**
 * A label with an amount at the right edge; long labels wrap on the left (the amount stays on the first row).
 * When the amount itself does not fit next to anything, the label rows go first and the amount alone after.
 */
function amountRows(label: string, amount: string, columns: number, bold: boolean): PrintLine[] {
  const value = printableText(amount);
  const room = columns - width(value) - 1;
  if (room < 4) {
    return [...wrapText(label, columns).map((row) => line(row, { bold })), line(value, { bold, align: "right" })];
  }
  const rows = wrapText(label, room);
  const [first = "", ...rest] = rows;
  return [line(spread(first, value, columns), { bold }), ...rest.map((row) => line(row, { bold }))];
}

/** An item: "2 x Name" (name wrapped under itself), amount on the right of the first row, details indented. */
function itemRows(item: TicketLine, columns: number): PrintLine[] {
  const prefix = `${item.quantity} x `;
  const indent = " ".repeat(width(prefix));
  const amount = item.amount ? printableText(item.amount) : "";
  // Kitchen tickets (no prices) print the items bold: they are what the cook reads.
  const bold = !amount;
  let room = columns - width(prefix) - (amount ? width(amount) + 1 : 0);
  let amountApart = false;
  if (room < 6) {
    // A huge amount on narrow paper: it goes on its own row, right-aligned.
    room = columns - width(prefix);
    amountApart = Boolean(amount);
  }
  // The first row shares its width with the amount; the rest of the name uses the whole row under it.
  const name = printableText(item.name).split(" ").filter(Boolean).join(" ");
  const [first = ""] = wrapText(name, room);
  const rest = wrapText(Array.from(name).slice(width(first)).join(""), columns - width(prefix));
  const rows: PrintLine[] = [
    line(amount && !amountApart ? spread(`${prefix}${first}`, amount, columns) : `${prefix}${first}`, { bold }),
    ...rest.map((row) => line(`${indent}${row}`, { bold })),
  ];
  if (amountApart) rows.push(line(amount, { align: "right" }));
  const detailIndent = width(indent) + 2 <= columns / 2 ? `${indent}` : "";
  for (const detail of item.details) {
    const wrapped = wrapText(detail, columns - width(detailIndent) - 2);
    wrapped.forEach((row, index) => rows.push(line(`${detailIndent}${index === 0 ? "" : "  "}${row}`)));
  }
  return rows;
}

/**
 * Lays a ticket out on a receipt printer of `columns` characters (see `ticketColumns`): every row already
 * wrapped, padded and styled, so the print agent only converts rows to ESC/POS. Big text (`size: 2`) uses
 * half the columns. The paper is cut at the end.
 */
export function layoutTicket(ticket: Ticket, columns: number): PrintLayout {
  const half = Math.floor(columns / 2);
  const rule = (char: string) => line(char.repeat(columns));
  const lines: PrintLine[] = [];
  if (ticket.banner) {
    lines.push(rule("="));
    for (const row of wrapText(ticket.banner, half)) lines.push(line(row, { align: "center", bold: true, size: 2 }));
    lines.push(rule("="));
  }
  for (const row of wrapText(ticket.headline, half)) lines.push(line(row, { align: "center", bold: true, size: 2 }));
  for (const row of wrapText(ticket.title, columns)) lines.push(line(row, { align: "center", bold: true }));
  for (const meta of ticket.meta) {
    for (const row of wrapText(meta, columns)) lines.push(line(row, { align: "center" }));
  }
  lines.push(rule("-"));
  for (const item of ticket.lines) lines.push(...itemRows(item, columns));
  if (ticket.totals.length > 0) {
    lines.push(rule("-"));
    for (const total of ticket.totals) lines.push(...amountRows(total.label, total.amount, columns, total.strong ?? false));
  }
  if (ticket.changes) {
    lines.push(rule("-"));
    for (const row of wrapText(ticket.changes.title, columns)) lines.push(line(row, { bold: true }));
    for (const change of ticket.changes.rows) {
      wrapText(change, columns - 2).forEach((row, index) => lines.push(line(`${index === 0 ? "- " : "  "}${row}`)));
    }
  }
  if (ticket.footer.length > 0) {
    lines.push(rule("-"));
    for (const footer of ticket.footer) {
      for (const row of wrapText(footer, columns)) lines.push(line(row));
    }
  }
  return { columns, lines, cut: true };
}

// ── Pairing codes ───────────────────────────────────────────────────────────

/** Characters of print agent pairing codes: base32-like without look-alikes (0/O, 1/I/L). */
export const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * A pairing code as typed: case, spaces and dashes ignored.
 * @param length Expected length (`PRINT_LIMITS.pairingCodeLength`).
 * @returns The canonical code, or null when it cannot be one.
 */
export function normalizePairingCode(input: string, length = 8): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== length) return null;
  for (const char of code) if (!PAIRING_CODE_ALPHABET.includes(char)) return null;
  return code;
}

/** "K7MX3QPA" → "K7MX-3QPA" (easier to read aloud and type). */
export function formatPairingCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
