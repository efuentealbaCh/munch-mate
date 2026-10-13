import { type PublicTableBill, TABLE_LIMITS, type TipChoice } from "@app/types";
import { suggestedTip } from "@app/utils";
import { parsePriceInput } from "./money";

/** What the customer picks in "Pedir la cuenta": the suggested tip, another amount, or none. */
export type TipMode = "suggested" | "amount" | "none";

/**
 * The tip choice the form describes, and the amount it means (shown as "Total con propina").
 * @param amountText What the customer typed for "Otro monto" ("2.500").
 * @returns null when "Otro monto" is not a valid amount.
 */
export function tipFromForm(
  mode: TipMode,
  amountText: string,
  bill: Pick<PublicTableBill, "subtotal" | "tipPercent">,
): { choice: TipChoice; amount: number } | null {
  if (mode === "none") return { choice: { kind: "none" }, amount: 0 };
  if (mode === "suggested") return { choice: { kind: "suggested" }, amount: suggestedTip(bill.subtotal, bill.tipPercent) };
  const amount = parsePriceInput(amountText);
  if (amount === null || amount > TABLE_LIMITS.tipMax) return null;
  return { choice: { kind: "amount", amount }, amount };
}

/** The mode to start the tip picker with: the suggestion when there is one (Chile: 10 %), else none. */
export function defaultTipMode(bill: Pick<PublicTableBill, "tipPercent">): TipMode {
  return bill.tipPercent > 0 ? "suggested" : "none";
}

/** Where the table's account stands, for the button and the sheet. */
export type BillStage = "empty" | "open" | "requested" | "paid";

export function billStage(bill: PublicTableBill | null): BillStage {
  if (!bill) return "empty";
  if (bill.closedAt) return "paid";
  if (!bill.open || bill.orderCount === 0) return "empty";
  return bill.billRequestedAt ? "requested" : "open";
}
