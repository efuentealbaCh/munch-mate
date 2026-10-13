import { type EqualPartView, SPLIT_LIMITS } from "@app/types";

/** Whether a table account can be split into this many equal parts (2–20). */
export function isValidSplitParts(parts: number): boolean {
  return Number.isInteger(parts) && parts >= SPLIT_LIMITS.partsMin && parts <= SPLIT_LIMITS.partsMax;
}

/**
 * What the next part of an equal split pays: what is left divided among the pending parts, rounded down; the
 * last pending part takes whatever is left, so the parts always add up to the bill. It is recomputed on every
 * payment, so new orders or deleted payments spread over the parts still pending.
 * Shared by the api (it charges this amount) and the web (previews).
 * @param remaining What is left to pay of the account (minor units).
 * @param parts Parts of the plan.
 * @param paidParts How many parts are already paid.
 * @returns The amount, never more than `remaining`, at least 1 while something is left; 0 when nothing is.
 */
export function equalPartAmount(remaining: number, parts: number, paidParts: number): number {
  if (remaining <= 0) return 0;
  const pending = parts - paidParts;
  if (pending <= 1) return remaining;
  // Tiny remainders (fewer pesos than parts) would round to 0: charge at least 1 so each payment counts.
  return Math.min(remaining, Math.max(1, Math.floor(remaining / pending)));
}

/**
 * The state of an equal split: the parts not paid yet and the amount of the next one.
 * @param paidPartNumbers Parts already paid (1-based); numbers outside 1..parts are ignored.
 */
export function equalSplitState(remaining: number, parts: number, paidPartNumbers: readonly number[]): EqualPartView {
  const paid = new Set(paidPartNumbers.filter((part) => part >= 1 && part <= parts));
  const pendingParts = Array.from({ length: parts }, (_, i) => i + 1).filter((part) => !paid.has(part));
  return {
    amount: pendingParts.length === 0 ? 0 : equalPartAmount(remaining, parts, parts - pendingParts.length),
    pendingParts,
  };
}
