import { TABLE_LIMITS, type TableSessionView } from "@app/types";
import { parsePriceInput } from "./money";

/** The floor ("Salón", phase 8): open table accounts, newest data wins, calls first. */

/** When the table asked for attention (a call or the bill), or null. */
export function attentionSince(session: Pick<TableSessionView, "waiterCalledAt" | "billRequestedAt">): string | null {
  const times = [session.waiterCalledAt, session.billRequestedAt].filter((t): t is string => t !== null);
  return times.length > 0 ? times.sort()[0]! : null;
}

/** Tables waiting for someone first (oldest call first), then the rest by when they sat down. */
export function sortSessions(sessions: readonly TableSessionView[]): TableSessionView[] {
  return [...sessions].sort((a, b) => {
    const aCall = attentionSince(a);
    const bCall = attentionSince(b);
    if (aCall && bCall) return aCall.localeCompare(bCall);
    if (aCall) return -1;
    if (bCall) return 1;
    return a.openedAt.localeCompare(b.openedAt);
  });
}

/** Applies a live update: closed accounts leave the floor, the rest are inserted or replaced. */
export function upsertSession(sessions: readonly TableSessionView[], update: TableSessionView): TableSessionView[] {
  const others = sessions.filter((s) => s.id !== update.id);
  return update.status === "open" ? [...others, update] : others;
}

/** Whether an update brings a new call or bill request the staff has not heard yet (to ring). */
export function isNewCall(previous: TableSessionView | undefined, update: TableSessionView): boolean {
  return (
    (update.waiterCalledAt !== null && update.waiterCalledAt !== previous?.waiterCalledAt) ||
    (update.billRequestedAt !== null && update.billRequestedAt !== previous?.billRequestedAt)
  );
}

/** The tip to start the charge form with: what the customer chose, else the suggestion. */
export function initialTip(session: Pick<TableSessionView, "requestedTip" | "suggestedTip">): number {
  return session.requestedTip ?? session.suggestedTip;
}

/** The tip typed in the charge form ("2.500"); "" means 0. @returns null when it is not a valid amount. */
export function parseTip(text: string): number | null {
  if (text.trim() === "") return 0;
  const amount = parsePriceInput(text);
  return amount !== null && amount <= TABLE_LIMITS.tipMax ? amount : null;
}

/** "hace 3 min" / "recién" for the call badges. */
export function minutesAgoLabel(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  return minutes < 1 ? "recién" : `hace ${minutes} min`;
}
