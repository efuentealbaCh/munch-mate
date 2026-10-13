"use client";

import { MESSAGE_CHANNEL_LABELS, MESSAGE_CHANNELS, type MessageChannel, TIP_LIMITS } from "@app/types";
import { formatPhone, normalizePhone, PHONE_EXAMPLE } from "@app/utils";
import { CircleAlertIcon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { PhoneInput } from "@/components/phone-input";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { restaurantsApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useRestaurant } from "./restaurant-context";

/**
 * Suggested tip on table bills (phase 8). Chile: voluntary, usually 10 %; the bill shows it with and without.
 * 0 = no suggestion.
 */
export function TipSettings() {
  const { restaurant } = useRestaurant();
  return <TipForm key={restaurant.tipPercent} />;
}

function TipForm() {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const id = useId();
  const [value, setValue] = useState(String(restaurant.tipPercent));
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const percent = /^\d{1,2}$/.test(value.trim()) ? Number(value.trim()) : null;
  const invalid = percent === null || percent > TIP_LIMITS.percentMax;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    setError(null);
    setSaving(true);
    try {
      setRestaurant(await restaurantsApi.update(restaurant.id, { tipPercent: percent }));
      toast.success(percent === 0 ? "Sin propina sugerida" : `Propina sugerida: ${percent} %`);
    } catch (failure) {
      setError(failure);
      if (hasCode(failure, "FORBIDDEN_ROLE")) reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" aria-label="Propina sugerida">
      <FormField
        id={`${id}-tip`}
        label="Propina sugerida"
        error={invalid ? `Un número entre 0 y ${TIP_LIMITS.percentMax}` : undefined}
        description="Se muestra al pedir la cuenta desde la mesa y en la precuenta, como voluntaria. 0 = sin sugerencia."
      >
        {(control) => (
          <div className="flex items-center gap-2">
            <Input
              {...control}
              inputMode="numeric"
              className="w-20"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={restaurant.status === "suspended"}
            />
            <span aria-hidden>%</span>
          </div>
        )}
      </FormField>
      <FormError error={error} />
      <SubmitButton pending={saving} disabled={invalid || percent === restaurant.tipPercent} variant="outline" className="self-start">
        Guardar propina
      </SubmitButton>
    </form>
  );
}

/**
 * WhatsApp or SMS notices to customers who ask for them at checkout (phase 8): the channel and the number they
 * come from. The number must be registered with the platform's messaging provider.
 */
export function MessagingSettings() {
  const { restaurant } = useRestaurant();
  const { messaging } = restaurant;
  return <MessagingForm key={`${messaging.enabled}|${messaging.channel}|${messaging.senderPhone}`} />;
}

function MessagingForm() {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const id = useId();
  const [enabled, setEnabled] = useState(restaurant.messaging.enabled);
  const [channel, setChannel] = useState<MessageChannel>(restaurant.messaging.channel);
  const [sender, setSender] = useState(formatPhone(restaurant.messaging.senderPhone));
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const normalized = sender.trim() ? normalizePhone(sender) : "";
  const senderProblem =
    normalized === null ? `Revisa el número, ej. ${PHONE_EXAMPLE}` : enabled && normalized === "" ? "Indica el número desde el que salen los avisos" : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (senderProblem) return;
    setError(null);
    setSaving(true);
    try {
      setRestaurant(await restaurantsApi.update(restaurant.id, { messaging: { enabled, channel, senderPhone: normalized ?? "" } }));
      toast.success(enabled ? `Avisos por ${MESSAGE_CHANNEL_LABELS[channel]} activados` : "Avisos por mensaje desactivados");
    } catch (failure) {
      setError(failure);
      if (hasCode(failure, "FORBIDDEN_ROLE")) reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" aria-label="Avisos por mensaje">
      {restaurant.messagingAvailable ? null : (
        <Alert role="status">
          <CircleAlertIcon aria-hidden />
          <AlertDescription>
            El envío de mensajes no está configurado en la plataforma todavía: puedes dejarlo listo, pero los clientes no verán la
            opción hasta que se active.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={`${id}-enabled`}>Avisar a los clientes por mensaje</Label>
          <p id={`${id}-enabled-help`} className="text-sm text-muted-foreground">
            En retiro y delivery el cliente elige si quiere avisos al aceptar, cuando está listo o sale a reparto.
          </p>
        </div>
        <Switch id={`${id}-enabled`} aria-describedby={`${id}-enabled-help`} checked={enabled} onCheckedChange={setEnabled} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Canal</legend>
        <div className="grid grid-cols-2 gap-2">
          {MESSAGE_CHANNELS.map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm",
                channel === option && "border-primary bg-brand-soft",
              )}
            >
              <input
                type="radio"
                name={`${id}-channel`}
                checked={channel === option}
                onChange={() => setChannel(option)}
                className="size-4 accent-primary"
              />
              {MESSAGE_CHANNEL_LABELS[option]}
            </label>
          ))}
        </div>
      </fieldset>
      <FormField
        id={`${id}-sender`}
        label="Número de envío"
        error={senderProblem ?? undefined}
        description={
          channel === "whatsapp"
            ? "El número de WhatsApp Business del local, registrado en la cuenta de mensajería de la plataforma."
            : "El número que envía los SMS, registrado en la cuenta de mensajería de la plataforma."
        }
      >
        {(control) => <PhoneInput {...control} maxLength={30} value={sender} onChange={(event) => setSender(event.target.value)} />}
      </FormField>
      <FormError error={error} />
      <SubmitButton pending={saving} disabled={senderProblem !== null} variant="outline" className="self-start">
        Guardar avisos
      </SubmitButton>
    </form>
  );
}
