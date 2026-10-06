import type { ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";

/** Accessibility props the field passes to its control. */
export interface ControlProps {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
}

/**
 * Label + control + description + error, wired for screen readers (the control is described by the
 * description and the error, and marked invalid while there is an error).
 * @param children Render function receiving the props to spread on the control.
 */
export function FormField({
  id,
  label,
  error,
  description,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  description?: ReactNode;
  children(control: ControlProps): ReactNode;
}) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}
