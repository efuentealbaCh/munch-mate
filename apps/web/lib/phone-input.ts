import { formatPhoneInput } from "@app/utils";

/** Prefix written in an empty customer phone field when it gets focus: most customers have a Chilean mobile. */
export const PHONE_PREFILL = "+569";

/** Field value and caret position after re-formatting an edit. */
export interface PhoneEdit {
  value: string;
  caret: number;
}

const digitCount = (text: string) => text.replace(/\D/g, "").length;

/**
 * Re-formats a phone field after the browser applied an edit ({@link formatPhoneInput}: "+569 12345678"),
 * keeping the caret next to the same digit so typing or deleting in the middle works.
 *
 * Backspace right after a separator ("+569 |1234") would only remove the space, which the formatter puts
 * back at once (the key would seem dead): in that case the digit before it is removed too.
 *
 * @param previous Value before the edit.
 * @param raw Value after the edit, as the browser left it.
 * @param caret Caret position in `raw`.
 * @param deletingBackward The edit was a backspace (`inputType === "deleteContentBackward"`).
 * @returns The formatted value and where the caret goes.
 */
export function editPhone(previous: string, raw: string, caret: number, deletingBackward = false): PhoneEdit {
  let text = raw;
  let at = Math.max(0, Math.min(caret, raw.length));
  if (deletingBackward && raw.length < previous.length && digitCount(raw) === digitCount(previous)) {
    const before = text.slice(0, at);
    const index = before.search(/\d(?=\D*$)/);
    if (index >= 0) {
      text = text.slice(0, index) + text.slice(index + 1);
      at = index;
    }
  }

  const value = formatPhoneInput(text);
  if (at >= text.length) return { value, caret: value.length };

  // The formatter only adds the country code ("56") in front, never removes digits: shift by what it added.
  const added = Math.max(0, digitCount(value) - digitCount(text));
  const target = digitCount(text.slice(0, at)) + added;
  if (target === 0) return { value, caret: value.startsWith("+") && at > 0 ? 1 : 0 };
  let seen = 0;
  for (let i = 0; i < value.length; i++) {
    if (/\d/.test(value[i] ?? "") && ++seen === target) return { value, caret: i + 1 };
  }
  return { value, caret: value.length };
}

/**
 * Whether the field holds only the prefix written on focus (or less), i.e. the customer typed no number:
 * the field is cleared on blur so the form says "Ingresa tu teléfono" instead of a format error.
 */
export function isOnlyPrefix(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits === "" || "569".startsWith(digits);
}
