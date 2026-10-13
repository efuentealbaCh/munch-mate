import { TABLE_LIMITS, TIP_LIMITS, type TipChoice } from "@app/types";

/** subtotal × percent, rounded to the currency unit (CLP: pesos). */
export function suggestedTip(subtotal: number, percent: number): number {
  if (subtotal <= 0 || percent <= 0) return 0;
  return Math.round((subtotal * percent) / 100);
}

/**
 * The tip amount a customer's choice means for a bill.
 * @returns null when the choice is not valid (negative, not an integer, above the limit).
 */
export function tipFromChoice(choice: TipChoice, subtotal: number, percent: number): number | null {
  switch (choice.kind) {
    case "suggested":
      return suggestedTip(subtotal, percent);
    case "none":
      return 0;
    case "amount":
      return Number.isInteger(choice.amount) && choice.amount >= 0 && choice.amount <= TABLE_LIMITS.tipMax
        ? choice.amount
        : null;
    default:
      return null;
  }
}

/** Whether a suggested tip percentage is acceptable as an owner setting (0 = no suggestion). */
export function isValidTipPercent(percent: number): boolean {
  return Number.isInteger(percent) && percent >= 0 && percent <= TIP_LIMITS.percentMax;
}
