"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { RoleCheckboxes } from "@/components/role-checkboxes";
import { SubmitButton } from "@/components/submit-button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { teamApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { type InviteValues, inviteSchema } from "@/lib/validation";

export function InviteForm({ restaurantId, onInvited }: { restaurantId: string; onInvited(): void }) {
  const [error, setError] = useState<unknown>(null);
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { email: "", roles: [] } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: InviteValues) {
    setError(null);
    try {
      const invitation = await teamApi.invite(restaurantId, values);
      toast.success(`Invitación enviada a ${invitation.email}`);
      form.reset();
      onInvited();
    } catch (failure) {
      if (hasCode(failure, "ALREADY_MEMBER")) {
        form.setError("email", { message: failure.message }, { shouldFocus: true });
      } else {
        setError(failure);
      }
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" aria-label="Invitar a alguien">
      <FormField id="invite-email" label="Correo" error={errors.email?.message}>
        {(control) => (
          <Input {...control} type="email" autoComplete="off" inputMode="email" {...form.register("email")} />
        )}
      </FormField>
      <div className="flex flex-col gap-2">
        <Controller
          control={form.control}
          name="roles"
          render={({ field }) => (
            <RoleCheckboxes
              idPrefix="invite-role"
              legend="Roles"
              value={field.value}
              onChange={field.onChange}
              invalid={Boolean(errors.roles)}
              describedBy={errors.roles ? "invite-roles-error" : undefined}
            />
          )}
        />
        {errors.roles ? <FieldError id="invite-roles-error">{errors.roles.message}</FieldError> : null}
      </div>
      <FormError error={error} />
      <SubmitButton pending={isSubmitting} className="self-start">
        Enviar invitación
      </SubmitButton>
    </form>
  );
}
