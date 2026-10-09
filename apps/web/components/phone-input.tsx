"use client";

import { PHONE_EXAMPLE } from "@app/utils";
import { type ComponentProps, useRef } from "react";
import { Input } from "@/components/ui/input";
import { editPhone, isOnlyPrefix, PHONE_PREFILL } from "@/lib/phone-input";

/**
 * Phone field that formats as you type ("+569 12345678", same rule as `formatPhone` everywhere else) with
 * the phone keyboard. Works with `form.register(...)` spread on it: the value is rewritten in the DOM before
 * the form's onChange reads it (the same approach as PriceInput). The form still validates with
 * normalizePhone and the api normalizes again.
 *
 * @param prefill Written when the field gets focus empty (customer checkout: "+569"); removed on blur if the
 *   customer typed nothing after it.
 */
export function PhoneInput({
  prefill,
  onChange,
  onFocus,
  onBlur,
  ...props
}: Omit<ComponentProps<"input">, "type" | "inputMode"> & { prefill?: boolean }) {
  // Value before each edit, to tell a backspace over a separator from one over a digit.
  const previous = useRef("");
  return (
    <Input
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={PHONE_EXAMPLE}
      {...props}
      onFocus={(event) => {
        const input = event.currentTarget;
        if (prefill && input.value === "") {
          input.value = PHONE_PREFILL;
          // After the browser places the caret for the tap/click.
          requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
        }
        previous.current = input.value;
        onFocus?.(event);
      }}
      onChange={(event) => {
        const input = event.target;
        const deleting = (event.nativeEvent as InputEvent).inputType === "deleteContentBackward";
        const edit = editPhone(previous.current, input.value, input.selectionStart ?? input.value.length, deleting);
        if (edit.value !== input.value) {
          input.value = edit.value;
          // Only while editing: moving the caret of an unfocused field (autofill) would steal focus on Safari.
          if (document.activeElement === input) input.setSelectionRange(edit.caret, edit.caret);
        }
        previous.current = edit.value;
        onChange?.(event);
      }}
      onBlur={(event) => {
        const input = event.target;
        if (prefill && input.value !== "" && isOnlyPrefix(input.value)) {
          // react-hook-form's onBlur reads the field again, so the form sees it empty too.
          input.value = "";
          previous.current = "";
        }
        onBlur?.(event);
      }}
    />
  );
}
