import { FINAL_ORDER_STATUSES, type LiveSummary, ORDER_CHANNELS } from "@app/types";
import { summarizeDay } from "./daily-summary";
import type { OrderRecord } from "./orders.repository";
import type { TableSessionRecord } from "./table-sessions.repository";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** What `summarizeLive` needs, already loaded by the service (tenant-scoped reads). */
export interface LiveSummaryInput {
  now: Date;
  /** IANA zone of the restaurant: hours and "same time last week" are local. */
  timeZone: string;
  currency: string;
  kitchenTargetMinutes: number;
  /** Every order of today's business day. */
  today: readonly OrderRecord[];
  /** Every order of the same weekday last week (business day − 7). */
  lastWeek: readonly OrderRecord[];
  /** Orders not final yet, of any day. */
  active: readonly OrderRecord[];
  /** Active tables placed on the floor plan (0 without a plan). */
  positionedTables: number;
  /** Open table accounts with how many orders each has (any status). */
  openAccounts: readonly {
    session: Pick<TableSessionRecord, "waiterCalledAt" | "billRequestedAt" | "payments">;
    orders: number;
  }[];
}

/** "YYYY-MM-DD" moved by whole days (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Hour (0–23) and second of the day of an instant on the local clock of a timezone. */
export function localTimeOfDay(at: Date, timeZone: string): { hour: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get("hour");
  return { hour, second: hour * 3600 + get("minute") * 60 + get("second") };
}

/**
 * Minutes the kitchen took with an order: from accepted to the first time it was ready (from pending — its
 * creation — when it was never accepted). Orders that never reached ready have no time. An order cancelled
 * after being ready still counts: the kitchen did the work.
 */
export function kitchenMinutes(order: Pick<OrderRecord, "statusHistory" | "createdAt">): number | null {
  const ready = order.statusHistory.find((change) => change.status === "ready");
  if (!ready) return null;
  const start =
    order.statusHistory.find((change) => change.status === "accepted")?.at ??
    order.statusHistory.find((change) => change.status === "pending")?.at ??
    order.createdAt;
  const minutes = (ready.at.getTime() - start.getTime()) / MINUTE_MS;
  return minutes >= 0 ? minutes : null;
}

const counts = (order: OrderRecord) => order.status !== "rejected" && order.status !== "cancelled";

/**
 * The live view's indicators (`GET /restaurants/:id/live`):
 * - sales: today's total as the daily summary computes it (rejected and cancelled orders never add), against
 *   the orders of the same weekday last week created up to the same local time of day. Comparing local clock
 *   times (not "now − 7 days") keeps the comparison right across a daylight saving change.
 * - hourly: today's sales per local hour of creation, from 0 to the current hour.
 * - inProgress: orders not final per channel.
 * - kitchen: average of `kitchenMinutes` over today's orders that reached ready, rounded to whole minutes.
 * - tables: open accounts that are occupied (an order or a call), calling, asking for the bill or paid in parts.
 */
export function summarizeLive(input: LiveSummaryInput): LiveSummary {
  const now = localTimeOfDay(input.now, input.timeZone);

  const total = summarizeDay(input.today, "", input.currency).sales.total;
  const lastWeekSoFar = input.lastWeek.filter(
    (order) => localTimeOfDay(order.createdAt, input.timeZone).second <= now.second,
  );
  const previous = summarizeDay(lastWeekSoFar, "", input.currency).sales.total;

  const hourly = Array.from({ length: now.hour + 1 }, (_, hour) => ({ hour, total: 0 }));
  for (const order of input.today) {
    if (!counts(order)) continue;
    const slot = hourly[localTimeOfDay(order.createdAt, input.timeZone).hour];
    // An order stamped after "now" (clock skew between replicas) has no slot yet: it still adds to the total.
    if (slot) slot.total += order.total;
  }

  const inProgress = { ...Object.fromEntries(ORDER_CHANNELS.map((c) => [c, 0])), total: 0 } as LiveSummary["inProgress"];
  for (const order of input.active) {
    if (FINAL_ORDER_STATUSES.includes(order.status)) continue;
    inProgress[order.channel]++;
    inProgress.total++;
  }

  const times = input.today.map(kitchenMinutes).filter((minutes): minutes is number => minutes !== null);
  const averageMinutes = times.length > 0 ? Math.round(times.reduce((sum, m) => sum + m, 0) / times.length) : null;

  const open = input.openAccounts;
  return {
    at: input.now.toISOString(),
    sales: {
      total,
      currency: input.currency,
      changePercent: previous > 0 ? Math.round(((total - previous) / previous) * 100) : null,
    },
    hourly,
    inProgress,
    kitchen: { averageMinutes, targetMinutes: input.kitchenTargetMinutes, sample: times.length },
    tables: {
      positioned: input.positionedTables,
      occupied: open.filter((a) => a.orders > 0 || a.session.waiterCalledAt !== null).length,
      callingWaiter: open.filter((a) => a.session.waiterCalledAt !== null).length,
      billRequested: open.filter((a) => a.session.billRequestedAt !== null).length,
      payingInParts: open.filter((a) => a.session.payments.length > 0).length,
    },
  };
}
