"use client";

import { DELIVERY_ZONE_LIMITS, type DeliveryZoneView } from "@app/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { HomeIcon, MapPinIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { PriceInput } from "@/components/price-input";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useApiQuery } from "@/hooks/use-api-query";
import { deliveryZonesApi, restaurantsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { formatPrice, formatPriceInput, parsePriceInput } from "@/lib/money";
import { type DeliveryZoneValues, deliveryZoneSchema } from "@/lib/validation";
import { useRestaurant } from "./restaurant-context";

/**
 * Owner card "Delivery": the switch that lets customers order for delivery, and the zones (commune or
 * sector, fee, minimum order, active, "zona del local"). The switch saves at once (optimistic, reverted on
 * failure); zones are edited in a dialog.
 */
export function DeliverySettings() {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const [saving, setSaving] = useState(false);
  const switchId = useId();
  const descriptionId = useId();
  const load = useCallback(() => deliveryZonesApi.list(restaurant.id), [restaurant.id]);
  const zonesQuery = useApiQuery<DeliveryZoneView[]>(load);
  const zones = zonesQuery.data;

  async function toggle(deliveryEnabled: boolean) {
    const previous = restaurant;
    setSaving(true);
    setRestaurant({ ...restaurant, deliveryEnabled });
    try {
      setRestaurant(await restaurantsApi.update(restaurant.id, { deliveryEnabled }));
      toast.success(deliveryEnabled ? "Ahora recibes pedidos con delivery" : "Desactivaste el delivery");
    } catch (failure) {
      setRestaurant(previous);
      toast.error(errorMessage(failure));
      // Lost the owner role meanwhile: reload so the page hides owner controls.
      if (hasCode(failure, "FORBIDDEN_ROLE")) reload();
    } finally {
      setSaving(false);
    }
  }

  const noActiveZones = zones !== undefined && !zones.some((zone) => zone.active);

  return (
    <div className="flex flex-col gap-4">
      <label htmlFor={switchId} className="flex cursor-pointer items-start gap-4">
        <Switch
          id={switchId}
          size="lg"
          className="mt-0.5"
          checked={restaurant.deliveryEnabled}
          disabled={saving || restaurant.status === "suspended"}
          aria-describedby={descriptionId}
          onCheckedChange={(checked) => void toggle(checked)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">Pedidos con delivery</span>
          <span id={descriptionId} className="text-sm text-muted-foreground">
            Tus clientes eligen su comuna o zona, escriben su dirección y dicen cómo pagarán. Tú aceptas cada pedido y
            les dices a qué hora llega. Pagan al recibir.
          </span>
        </span>
      </label>
      {restaurant.deliveryEnabled && noActiveZones ? (
        <p className="rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground" role="status" data-testid="no-zones-warning">
          No tienes zonas activas: los clientes no podrán pedir delivery hasta que agregues o actives una.
        </p>
      ) : null}
      {restaurant.deliveryEnabled && !restaurant.acceptingOrders ? (
        <p className="rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground" role="status">
          El local está cerrado: abre en <strong>Pedidos</strong> («Recibiendo pedidos») para que puedan pedir.
        </p>
      ) : null}
      <ZoneList
        restaurantId={restaurant.id}
        currency={restaurant.currency}
        zones={zones}
        error={zonesQuery.error}
        loading={zonesQuery.loading}
        onRetry={zonesQuery.reload}
        onChange={(update) => zonesQuery.setData((current) => current && update(current))}
        onStale={zonesQuery.reload}
      />
    </div>
  );
}

/** Applies a saved zone to the list; the api unmarks the previous home zone, so the copy does the same. */
function withSaved(list: DeliveryZoneView[], saved: DeliveryZoneView): DeliveryZoneView[] {
  const others = list.filter((zone) => zone.id !== saved.id).map((zone) => (saved.isHome ? { ...zone, isHome: false } : zone));
  return [...others, saved].sort((a, b) => a.position - b.position);
}

function ZoneList({
  restaurantId,
  currency,
  zones,
  error,
  loading,
  onRetry,
  onChange,
  onStale,
}: {
  restaurantId: string;
  currency: string;
  zones: DeliveryZoneView[] | undefined;
  error: unknown;
  loading: boolean;
  onRetry(): void;
  onChange(update: (list: DeliveryZoneView[]) => DeliveryZoneView[]): void;
  onStale(): void;
}) {
  const [editing, setEditing] = useState<DeliveryZoneView | "new" | null>(null);
  const [deleting, setDeleting] = useState<DeliveryZoneView | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [homePending, setHomePending] = useState<string | null>(null);

  async function remove(zone: DeliveryZoneView) {
    setDeletePending(true);
    try {
      await deliveryZonesApi.delete(restaurantId, zone.id);
      onChange((list) => list.filter((z) => z.id !== zone.id));
      toast.success(`Zona «${zone.name}» eliminada`);
    } catch (failure) {
      toast.error(errorMessage(failure));
      if (hasCode(failure, "ZONE_NOT_FOUND")) onStale();
    } finally {
      setDeletePending(false);
      setDeleting(null);
    }
  }

  async function makeHome(zone: DeliveryZoneView) {
    setHomePending(zone.id);
    try {
      const saved = await deliveryZonesApi.update(restaurantId, zone.id, { isHome: true });
      onChange((list) => withSaved(list, saved));
      toast.success(`«${zone.name}» es ahora la zona del local`);
    } catch (failure) {
      toast.error(errorMessage(failure));
      if (hasCode(failure, "ZONE_NOT_FOUND")) onStale();
    } finally {
      setHomePending(null);
    }
  }

  return (
    <section aria-labelledby="zonas-reparto" className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="zonas-reparto" className="font-semibold">
          Zonas de reparto
        </h3>
        <Button
          size="sm"
          variant="outline"
          disabled={!zones || zones.length >= DELIVERY_ZONE_LIMITS.zonesMax}
          onClick={() => setEditing("new")}
        >
          <PlusIcon aria-hidden data-icon="inline-start" />
          Agregar zona
        </Button>
      </div>
      {!zones ? (
        error ? (
          <div className="flex flex-col items-start gap-3">
            <FormError error={error} />
            <Button variant="outline" onClick={onRetry}>
              Reintentar
            </Button>
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Cargando zonas">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : null
      ) : zones.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          Agrega las comunas o sectores a los que repartes, con su costo de envío y pedido mínimo.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg ring-1 ring-foreground/10" aria-label="Zonas de reparto">
          {zones.map((zone) => (
            <li key={zone.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5" data-testid="zone-row">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  <MapPinIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="break-words">{zone.name}</span>
                  {zone.isHome ? (
                    <Badge variant="secondary" className="bg-brand-soft">
                      <HomeIcon aria-hidden />
                      Zona del local
                    </Badge>
                  ) : null}
                  {zone.active ? null : <Badge variant="outline">Inactiva</Badge>}
                </span>
                <span className="text-sm text-muted-foreground">
                  Envío {zone.fee > 0 ? formatPrice(zone.fee, currency) : "gratis"} · Mínimo{" "}
                  {zone.minOrder > 0 ? formatPrice(zone.minOrder, currency) : "sin mínimo"}
                </span>
              </span>
              <span className="flex items-center gap-1">
                {zone.isHome ? null : (
                  <Button size="sm" variant="ghost" disabled={homePending !== null} aria-busy={homePending === zone.id || undefined} onClick={() => void makeHome(zone)}>
                    Marcar del local
                  </Button>
                )}
                <Button size="icon-sm" variant="ghost" aria-label={`Editar ${zone.name}`} onClick={() => setEditing(zone)}>
                  <PencilIcon aria-hidden />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Eliminar ${zone.name}`} onClick={() => setDeleting(zone)}>
                  <Trash2Icon aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <ZoneDialog
        restaurantId={restaurantId}
        zone={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={(saved) => onChange((list) => withSaved(list, saved))}
        onStale={onStale}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `¿Eliminar la zona «${deleting.name}»?` : "¿Eliminar la zona?"}
        description="Los clientes ya no podrán elegirla. Los pedidos ya hechos no cambian. Si solo quieres pausarla, edítala y desactívala."
        confirmLabel="Eliminar"
        destructive
        pending={deletePending}
        onConfirm={() => deleting && void remove(deleting)}
      />
    </section>
  );
}

function ZoneDialog({
  open,
  onOpenChange,
  ...props
}: {
  restaurantId: string;
  /** null = new zone. */
  zone: DeliveryZoneView | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(zone: DeliveryZoneView): void;
  onStale(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remounted on every open, so the form starts from the current values. */}
        {open ? <ZoneForm {...props} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ZoneForm({
  restaurantId,
  zone,
  onSaved,
  onStale,
  onClose,
}: {
  restaurantId: string;
  zone: DeliveryZoneView | null;
  onSaved(zone: DeliveryZoneView): void;
  onStale(): void;
  onClose(): void;
}) {
  const form = useForm<DeliveryZoneValues>({
    resolver: zodResolver(deliveryZoneSchema),
    defaultValues: {
      name: zone?.name ?? "",
      fee: zone ? formatPriceInput(zone.fee) : "",
      minOrder: zone ? formatPriceInput(zone.minOrder) : "0",
      active: zone?.active ?? true,
      isHome: zone?.isHome ?? false,
    },
  });
  const { errors } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(values: DeliveryZoneValues) {
    setError(null);
    setSaving(true);
    // Validated by the schema: both parse.
    const body = {
      name: values.name,
      fee: parsePriceInput(values.fee) ?? 0,
      minOrder: parsePriceInput(values.minOrder) ?? 0,
      active: values.active,
      isHome: values.isHome,
    };
    try {
      const saved = zone ? await deliveryZonesApi.update(restaurantId, zone.id, body) : await deliveryZonesApi.create(restaurantId, body);
      onSaved(saved);
      toast.success(zone ? "Zona actualizada" : `Zona «${saved.name}» agregada`);
      onClose();
    } catch (failure) {
      setSaving(false);
      if (hasCode(failure, "ZONE_NOT_FOUND")) {
        toast.error(failure.message);
        onStale();
        onClose();
        return;
      }
      setError(failure);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{zone ? "Editar zona" : "Nueva zona de reparto"}</DialogTitle>
        <DialogDescription>Una comuna o sector al que repartes. El pedido mínimo no incluye el envío.</DialogDescription>
      </DialogHeader>
      <FormField id="zone-name" label="Comuna o sector" error={errors.name?.message}>
        {(control) => (
          <Input {...control} autoComplete="off" placeholder="Ej. Providencia" maxLength={DELIVERY_ZONE_LIMITS.nameMax} {...form.register("name")} />
        )}
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField id="zone-fee" label="Costo de envío" error={errors.fee?.message}>
          {(control) => <PriceInput {...control} placeholder="1.990" {...form.register("fee")} />}
        </FormField>
        <FormField id="zone-min" label="Pedido mínimo" error={errors.minOrder?.message}>
          {(control) => <PriceInput {...control} placeholder="0" {...form.register("minOrder")} />}
        </FormField>
      </div>
      <Controller
        control={form.control}
        name="active"
        render={({ field }) => (
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="zone-active">Activa</Label>
              <p id="zone-active-help" className="text-sm text-muted-foreground">
                Si la desactivas, los clientes no pueden elegirla.
              </p>
            </div>
            <Switch id="zone-active" aria-describedby="zone-active-help" checked={field.value} onCheckedChange={field.onChange} />
          </div>
        )}
      />
      <Controller
        control={form.control}
        name="isHome"
        render={({ field }) => (
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="zone-home">Zona del local</Label>
              <p id="zone-home-help" className="text-sm text-muted-foreground">
                Viene elegida al pedir. Solo una zona puede serlo.
              </p>
            </div>
            <Switch id="zone-home" aria-describedby="zone-home-help" checked={field.value} onCheckedChange={field.onChange} />
          </div>
        )}
      />
      <FormError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <SubmitButton pending={saving}>{zone ? "Guardar" : "Agregar zona"}</SubmitButton>
      </DialogFooter>
    </form>
  );
}
