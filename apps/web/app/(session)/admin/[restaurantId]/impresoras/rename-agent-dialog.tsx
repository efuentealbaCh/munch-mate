"use client";

import { PRINT_LIMITS, type PrintAgentView } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { printAgentsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { type PrintAgentNameValues, printAgentNameSchema } from "@/lib/validation";

/** Renames a paired computer ("Cocina", "Barra"). The agent shows the new name too. */
export function RenameAgentDialog({
  restaurantId,
  agent,
  onOpenChange,
  onSaved,
  onGone,
}: {
  restaurantId: string;
  /** null = closed. */
  agent: PrintAgentView | null;
  onOpenChange(open: boolean): void;
  onSaved(agent: PrintAgentView): void;
  /** The computer was unpaired meanwhile (another tab): reload the list. */
  onGone(): void;
}) {
  return (
    <Dialog open={agent !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {agent ? (
          <RenameForm
            key={agent.id}
            restaurantId={restaurantId}
            agent={agent}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
            onGone={onGone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  restaurantId,
  agent,
  onClose,
  onSaved,
  onGone,
}: {
  restaurantId: string;
  agent: PrintAgentView;
  onClose(): void;
  onSaved(agent: PrintAgentView): void;
  onGone(): void;
}) {
  const form = useForm<PrintAgentNameValues>({ resolver: zodResolver(printAgentNameSchema), defaultValues: { name: agent.name } });
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function submit(values: PrintAgentNameValues) {
    if (values.name === agent.name) return onClose();
    setSaving(true);
    setError(null);
    try {
      onSaved(await printAgentsApi.rename(restaurantId, agent.id, values.name));
      onClose();
    } catch (failure) {
      setSaving(false);
      if (hasCode(failure, "PRINT_AGENT_NOT_FOUND")) {
        toast.error(errorMessage(failure));
        onGone();
        onClose();
      } else setError(failure);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Renombrar equipo</DialogTitle>
        <DialogDescription>Un nombre para reconocerlo, por ejemplo «Cocina» o «Barra».</DialogDescription>
      </DialogHeader>
      <FormField id="print-agent-rename" label="Nombre" error={form.formState.errors.name?.message}>
        {(control) => <Input {...control} autoComplete="off" maxLength={PRINT_LIMITS.agentNameMax} {...form.register("name")} />}
      </FormField>
      <FormError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <SubmitButton pending={saving}>Guardar</SubmitButton>
      </DialogFooter>
    </form>
  );
}
