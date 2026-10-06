import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { errorMessage, hasCode } from "@/lib/errors";

/**
 * Form-level error. Pass the caught `error` (its user-facing message is derived, plus the field list for
 * VALIDATION_FAILED) or an explicit `message`. Lives inside an always-present live region so screen
 * readers announce it when it appears; renders nothing visible while there is no error.
 */
export function FormError({ error, message, children }: { error?: unknown; message?: string | null; children?: ReactNode }) {
  const text = message ?? (error ? errorMessage(error) : null);
  const details = hasCode(error, "VALIDATION_FAILED") ? error.details : undefined;
  return (
    <div aria-live="assertive" aria-atomic="true">
      {text ? (
        <Alert variant="destructive" role="none" className="border-destructive/30 bg-destructive/5">
          <CircleAlertIcon aria-hidden />
          <AlertDescription className="text-destructive">
            <p>{text}</p>
            {details?.length ? (
              <ul className="mt-1 list-disc pl-4">
                {details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
            {children}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
