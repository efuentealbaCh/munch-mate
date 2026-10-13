/**
 * Keeps what a visitor typed into a server-rendered form before React hydrated it.
 *
 * Why: react-hook-form writes `defaultValues` into the DOM when `register()`'s ref attaches (its
 * `updateValidAndValue` → `setFieldValue`), so text typed into the server HTML on a slow phone (or by a
 * fast test) is replaced by "" during hydration and the form submits empty. `register()` returns no
 * `value`/`defaultValue` prop, so starting the form from the typed values causes no hydration mismatch:
 * React never compares input values, only react-hook-form writes them afterwards.
 *
 * Scope, on purpose:
 * - Only text-like controls (`text`, `email`, `tel`, `password`, `search`, `url`, `number`, `textarea`)
 *   and only fields whose default is a string. Checkboxes, radios and selects keep their defaults: their
 *   server state is not "typed" and guessing their value type (boolean, array, id) is not worth it.
 * - Only non-empty typed values replace a default, so prefilled defaults (e.g. `?email=` on /registro)
 *   still apply when nothing was typed.
 * - Fields are read inside `<form data-form="<formId>">` only: during a client-side navigation the
 *   previous page (with its own `name="email"`) can still be in the DOM while the next one renders.
 * - The DOM is read while rendering, so this only helps on the hydration render of a server-rendered
 *   form. On the server, or when the form is client-rendered (navigation, Suspense fallback, sheets),
 *   there is no matching input yet and the defaults are returned unchanged.
 */

/** Returns the non-empty value typed into the field `name`, or null to keep the default. */
export type TypedValueReader = (name: string) => string | null;

/** The minimal DOM surface the reader needs (structural, so tests can pass plain objects). */
export interface FieldElementLike {
  readonly tagName: string;
  readonly type?: string;
  readonly value?: string;
  getAttribute(name: string): string | null;
}

export interface FormRootLike {
  querySelector(selectors: string): { querySelectorAll(selectors: string): ArrayLike<FieldElementLike> } | null;
}

const TEXT_INPUT_TYPES = new Set(["text", "email", "tel", "password", "search", "url", "number"]);

function isTextControl(element: FieldElementLike): boolean {
  const tag = element.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  // An <input> without a type attribute is a text input (`.type` already reports "text" in browsers).
  return tag === "INPUT" && TEXT_INPUT_TYPES.has((element.type || "text").toLowerCase());
}

/**
 * Builds a reader for the fields of `<form data-form="<formId>">` in `root`.
 *
 * @param formId value of the form's `data-form` attribute (letters, digits and dashes).
 * @param root document (or any element) to search; defaults to the browser document.
 * @returns a reader that yields the typed value of a text-like field, or null when the form or field is
 *   missing, the field is not text-like, the name is ambiguous or nothing was typed.
 */
export function domTypedValueReader(formId: string, root: FormRootLike): TypedValueReader {
  const form = root.querySelector(`form[data-form="${formId}"]`);
  if (!form) return () => null;
  const controls = Array.from(form.querySelectorAll("[name]"));
  return (name) => {
    // Compared by attribute instead of building a selector: names like "address.street" need no escaping.
    const matches = controls.filter((element) => element.getAttribute("name") === name);
    if (matches.length !== 1) return null;
    const [control] = matches as [FieldElementLike];
    if (!isTextControl(control)) return null;
    return control.value ? control.value : null;
  };
}

/**
 * Overrides the string defaults with the values the reader reports as typed.
 *
 * @param defaults the form's normal `defaultValues`.
 * @param read typed-value reader (see `domTypedValueReader`).
 * @returns `defaults` itself when nothing was typed, otherwise a copy with the typed strings.
 */
export function mergeTypedValues<T extends object>(defaults: T, read: TypedValueReader): T {
  let merged: T | null = null;
  for (const [name, value] of Object.entries(defaults)) {
    if (typeof value !== "string") continue;
    const typed = read(name);
    if (typed === null || typed === value) continue;
    merged ??= { ...defaults };
    (merged as Record<string, unknown>)[name] = typed;
  }
  return merged ?? defaults;
}

/**
 * `defaultValues` for a form that can be server-rendered: the given defaults, replaced field by field by
 * whatever was already typed into `<form data-form="<formId>">` before hydration (client only).
 *
 * useForm reads `defaultValues` only on its first render, so later calls are just a cheap DOM query.
 *
 * @param formId value of the form's `data-form` attribute.
 * @param defaults the form's normal `defaultValues` (top-level string fields are the ones considered).
 */
export function typedDefaults<T extends object>(formId: string, defaults: T): T {
  if (typeof document === "undefined") return defaults;
  return mergeTypedValues(defaults, domTypedValueReader(formId, document));
}
