"use client";

import { PHONE_EXAMPLE } from "@app/utils";
import { type ComponentProps, useRef } from "react";
import { Input } from "@/components/ui/input";
import { editPhone } from "@/lib/phone-input";

/**
 * Phone field that formats as you type ("+569 12345678", same rule as `formatPhone` everywhere else) with
 * the phone keyboard. Works with `form.register(...)` spread on it: the value is rewritten in the DOM before
 * the form's onChange reads it (the same approach as PriceInput). The form still validates with
 * normalizePhone and the api normalizes again.
 *
 * No "+569" is written in advance: Chileans type their mobile starting with 9 ("9 1234 5678"), which after a
 * prefilled "+569" became "+569 912345678" (a wrong number). The formatter adds "+569" itself as soon as a
 * 9 is typed, and "+569 9xxxxxxx" is a valid mobile, so a doubled 9 cannot be guessed away afterwards.
 */
export function PhoneInput({ onChange, onFocus, ...props }: Omit<ComponentProps<"input">, "type" | "inputMode">) {
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
        previous.current = event.currentTarget.value;
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
    />
  );
}
