import { REPORT_LIMITS, type SalesExportKind } from "@app/types";
import { shiftDate } from "./daily-summary";

/** Sales between two dates and their exports (phase 8). Dates are business days, "YYYY-MM-DD". */

export interface DateRange {
  from: string;
  to: string;
}

/** Number of days in a range, both ends included. */
export function rangeDays({ from, to }: DateRange): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Why a range cannot be reported (Spanish, for the form), or null. Same rules as the api. */
export function rangeProblem(range: DateRange, today: string): string | null {
  if (!range.from || !range.to) return "Elige las dos fechas";
  if (range.from > range.to) return "La fecha de inicio debe ser anterior a la de término";
  if (range.from > today) return "Aún no hay ventas para esas fechas";
  if (rangeDays(range) > REPORT_LIMITS.rangeDaysMax) return `Elige como máximo ${REPORT_LIMITS.rangeDaysMax} días`;
  return null;
}

/** Quick ranges: this week (Monday first), the last 7 days, this month and last month. */
export function rangePresets(today: string): { label: string; range: DateRange }[] {
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shiftDate(monthStart, -1);
  return [
    { label: "Esta semana", range: { from: shiftDate(today, -weekday), to: today } },
    { label: "Últimos 7 días", range: { from: shiftDate(today, -6), to: today } },
    { label: "Este mes", range: { from: monthStart, to: today } },
    { label: "Mes pasado", range: { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd } },
  ];
}

export const EXPORT_LABELS: Record<SalesExportKind, string> = {
  orders: "Pedidos",
  products: "Productos",
  days: "Por día",
};

/** "12-10-2026" for the day rows and the printed header. */
export function shortDate(date: string): string {
  return `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
}
