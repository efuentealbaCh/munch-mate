import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Submit button that shows a spinner and blocks double submits while `pending`. */
export function SubmitButton({ pending, children, disabled, ...props }: ComponentProps<typeof Button> & { pending: boolean }) {
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending || undefined} {...props}>
      {pending ? <Spinner aria-hidden data-icon="inline-start" /> : null}
      {children}
    </Button>
  );
}
