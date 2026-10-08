"use client";

import { CircleCheckIcon, CircleXIcon, InfoIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { usePublicHost } from "@/hooks/use-slug-availability";
import { SLUG_PROBLEM_MESSAGES, type SlugStatus } from "@/lib/slug-field";
import { cn } from "@/lib/utils";

interface SlugFieldProps {
  id: string;
  status: SlugStatus;
  /** Error coming from the form or the api (INVALID_SLUG); shown instead of the status. */
  error?: string;
  /** Props for the <input> (react-hook-form `register` result). */
  inputProps: ComponentProps<"input">;
  onUseSuggestion(suggestion: string): void;
}

/** Slug input with the public URL prefix and a live availability line (announced politely). */
export function SlugField({ id, status, error, inputProps, onUseSuggestion }: SlugFieldProps) {
  const host = usePublicHost();
  const statusId = `${id}-status`;
  const helpId = `${id}-help`;
  const invalid = Boolean(error) || status.kind === "invalid" || status.kind === "taken";

  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>Dirección web</FieldLabel>
      <div
        className={cn(
          "flex h-10 w-full min-w-0 items-center overflow-hidden rounded-lg border border-input bg-card text-base transition-colors md:text-sm",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          invalid && "border-destructive ring-destructive/20 focus-within:border-destructive focus-within:ring-destructive/20",
        )}
      >
        <span className="flex h-full max-w-[55%] shrink-0 items-center truncate border-r bg-muted px-3 text-muted-foreground" aria-hidden>
          {host ? `${host}/r/` : "/r/"}
        </span>
        <input
          id={id}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={`${helpId} ${statusId}`}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-foreground outline-none"
          {...inputProps}
        />
      </div>
      <FieldDescription id={helpId}>Es el enlace de tu menú. Solo minúsculas, números y guiones.</FieldDescription>
      <div id={statusId} aria-live="polite" className="min-h-6 text-sm">
        <SlugStatusLine status={status} error={error} onUseSuggestion={onUseSuggestion} />
      </div>
    </Field>
  );
}

function SlugStatusLine({
  status,
  error,
  onUseSuggestion,
}: {
  status: SlugStatus;
  error?: string;
  onUseSuggestion(suggestion: string): void;
}) {
  if (error) return <Line tone="error">{error}</Line>;
  switch (status.kind) {
    case "idle":
      return null;
    case "unchanged":
      return <Line tone="muted">Es la dirección actual.</Line>;
    case "checking":
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Spinner aria-hidden className="size-3.5" /> Revisando disponibilidad…
        </span>
      );
    case "available":
      return <Line tone="ok">Disponible</Line>;
    case "invalid":
      return <Line tone="error">{SLUG_PROBLEM_MESSAGES[status.problem]}</Line>;
    case "taken":
      return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Line tone="error">En uso por otro restaurante.</Line>
          {status.suggestion ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onUseSuggestion(status.suggestion as string)}>
              Usar {status.suggestion}
            </Button>
          ) : null}
        </span>
      );
    case "error":
      return <Line tone="muted">No pudimos revisar la disponibilidad: {status.message}</Line>;
  }
}

function Line({ tone, children }: { tone: "ok" | "error" | "muted"; children: React.ReactNode }) {
  const Icon = tone === "ok" ? CircleCheckIcon : tone === "error" ? CircleXIcon : InfoIcon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        tone === "ok" && "font-medium text-success",
        tone === "error" && "text-destructive",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {children}
    </span>
  );
}
