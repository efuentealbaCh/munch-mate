"use client";

import { CUSTOMER_LIMITS, type GeoPoint, type MapConfig, ORDER_LIMITS, type SavedAddressView } from "@app/types";
import { formatPhone, normalizePhone } from "@app/utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { LocateFixedIcon, MapPinHouseIcon, MapPinIcon, MapPinOffIcon, PencilIcon, PlusIcon, ReceiptTextIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { FormField } from "@/components/form-field";
import { PinMap } from "@/components/map";
import { PhoneInput } from "@/components/phone-input";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useApiQuery } from "@/hooks/use-api-query";
import { useCurrentPosition } from "@/hooks/use-current-position";
import { useMapConfig } from "@/hooks/use-map-config";
import { useAuth } from "@/lib/auth-context";
import { savedAddressLine, suggestAddressLabel, toSavedAddressInput } from "@/lib/customer";
import { customersApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { GEOLOCATION_MESSAGES } from "@/lib/maps";
import { type CustomerProfileValues, customerProfileSchema, type SavedAddressValues, savedAddressSchema } from "@/lib/validation";

const CARD_SPACING = "[--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]";

/** "Mi cuenta": the data the checkout uses (name, phone) and the saved delivery addresses. */
export function AccountView() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">Mi cuenta</h1>
          <p className="text-sm text-muted-foreground">Con estos datos rellenamos tus pedidos en cualquier local.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/mis-pedidos">
            <ReceiptTextIcon aria-hidden data-icon="inline-start" />
            Mis pedidos
          </Link>
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[2fr_3fr] lg:items-start">
        <Card className={CARD_SPACING}>
          <CardHeader>
            <CardTitle>
              <h2>Tus datos</h2>
            </CardTitle>
            <CardDescription>El local los usa para avisarte si hay algún problema con tu pedido.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm />
          </CardContent>
        </Card>
        <Card className={CARD_SPACING}>
          <CardHeader>
            <CardTitle>
              <h2>Mis direcciones</h2>
            </CardTitle>
            <CardDescription>Para elegirlas al pedir delivery, sin escribirlas de nuevo.</CardDescription>
          </CardHeader>
          <CardContent>
            <AddressesSection />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProfileForm() {
  const { user, setUser } = useAuth();
  const form = useForm<CustomerProfileValues>({
    resolver: zodResolver(customerProfileSchema),
    defaultValues: { name: user?.name ?? "", phone: formatPhone(user?.phone ?? "") },
  });
  const { errors } = form.formState;
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  if (!user) return null;

  async function onSubmit(values: CustomerProfileValues) {
    if (!user) return;
    setError(null);
    // The api stores it normalized (+56912345678): compare and send it that way.
    const phone = values.phone === "" ? "" : (normalizePhone(values.phone) ?? values.phone);
    const changes = {
      ...(values.name !== user.name ? { name: values.name } : {}),
      ...(phone !== user.phone ? { phone } : {}),
    };
    if (Object.keys(changes).length === 0) {
      toast.info("No hay cambios que guardar");
      return;
    }
    setSaving(true);
    try {
      const updated = await customersApi.updateProfile(changes);
      setUser(updated);
      form.reset({ name: updated.name, phone: formatPhone(updated.phone) });
      toast.success("Guardamos tus datos");
    } catch (failure) {
      if (hasCode(failure, "INVALID_PHONE")) form.setError("phone", { message: failure.message });
      else setError(failure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" aria-label="Tus datos">
      <FormField id="account-name" label="Nombre" error={errors.name?.message}>
        {(control) => <Input {...control} autoComplete="name" maxLength={100} aria-required {...form.register("name")} />}
      </FormField>
      <FormField
        id="account-phone"
        label="Teléfono (opcional)"
        error={errors.phone?.message}
        description="Lo rellenamos al pedir para retiro o delivery."
      >
        {(control) => <PhoneInput {...control} maxLength={30} {...form.register("phone")} />}
      </FormField>
      <p className="text-sm text-muted-foreground">
        Correo: <span className="font-medium text-foreground">{user.email}</span>
      </p>
      <FormError error={error} />
      <SubmitButton pending={saving} className="self-start">
        Guardar datos
      </SubmitButton>
    </form>
  );
}

/** Which dialog is open: a new address, or editing one. */
type Editing = { mode: "new" } | { mode: "edit"; address: SavedAddressView } | null;

function AddressesSection() {
  const { data: addresses, error, loading, reload, setData } = useApiQuery(customersApi.addresses);
  const map = useMapConfig();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<SavedAddressView | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const atLimit = (addresses?.length ?? 0) >= CUSTOMER_LIMITS.addressesMax;

  async function remove() {
    if (!removing) return;
    setRemovePending(true);
    try {
      await customersApi.deleteAddress(removing.id);
      setData((list) => list?.filter((a) => a.id !== removing.id));
      toast.success(`Eliminaste «${removing.label}»`);
    } catch (failure) {
      toast.error(errorMessage(failure));
      reload();
    } finally {
      setRemovePending(false);
      setRemoving(null);
    }
  }

  function saved(address: SavedAddressView) {
    setData((list) => {
      const rest = (list ?? []).filter((a) => a.id !== address.id);
      // Keep the position of an edited address; new ones go last (the api lists them in creation order).
      const index = (list ?? []).findIndex((a) => a.id === address.id);
      if (index < 0) return [...rest, address];
      rest.splice(index, 0, address);
      return rest;
    });
    setEditing(null);
  }

  if (error && !addresses) {
    return (
      <div className="flex flex-col items-start gap-3">
        <FormError error={error} />
        <Button variant="outline" onClick={reload}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (loading && !addresses) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando direcciones">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {addresses && addresses.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10" data-testid="saved-addresses">
          {addresses.map((address) => (
            <li key={address.id} className="flex items-start gap-3 p-3">
              {address.location ? (
                <MapPinIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-label="Con ubicación en el mapa" />
              ) : (
                <MapPinHouseIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{address.label}</span>
                <span className="text-sm break-words">{savedAddressLine(address)}</span>
                {address.reference ? <span className="text-sm break-words text-muted-foreground">Ref.: {address.reference}</span> : null}
              </span>
              <span className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" aria-label={`Editar ${address.label}`} onClick={() => setEditing({ mode: "edit", address })}>
                  <PencilIcon aria-hidden />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Eliminar ${address.label}`} onClick={() => setRemoving(address)}>
                  <Trash2Icon aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
          <MapPinOffIcon className="size-4 shrink-0" aria-hidden />
          No tienes direcciones guardadas. También puedes guardarlas al pedir delivery.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <Button variant="outline" className="self-start" disabled={atLimit} onClick={() => setEditing({ mode: "new" })}>
          <PlusIcon aria-hidden data-icon="inline-start" />
          Agregar dirección
        </Button>
        {atLimit ? (
          <p className="text-sm text-muted-foreground" role="status">
            Puedes guardar hasta {CUSTOMER_LIMITS.addressesMax} direcciones. Elimina una para agregar otra.
          </p>
        ) : null}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-xl">
          {editing ? (
            <AddressForm
              address={editing.mode === "edit" ? editing.address : null}
              suggestedLabel={suggestAddressLabel(addresses ?? [])}
              mapConfig={map.available ? map.config : null}
              onSaved={saved}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`¿Eliminar «${removing?.label ?? ""}»?`}
        description="Ya no aparecerá al pedir delivery. Tus pedidos anteriores no cambian."
        confirmLabel="Eliminar"
        destructive
        pending={removePending}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function AddressForm({
  address,
  suggestedLabel,
  mapConfig,
  onSaved,
  onCancel,
}: {
  /** null = new address. */
  address: SavedAddressView | null;
  suggestedLabel: string;
  /** null = no map on this server: text only. */
  mapConfig: MapConfig | null;
  onSaved(address: SavedAddressView): void;
  onCancel(): void;
}) {
  const form = useForm<SavedAddressValues>({
    resolver: zodResolver(savedAddressSchema),
    defaultValues: {
      label: address?.label ?? suggestedLabel,
      address: address?.address ?? "",
      unit: address?.unit ?? "",
      reference: address?.reference ?? "",
    },
  });
  const { errors } = form.formState;
  const [pin, setPin] = useState<GeoPoint | null>(address?.location ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const geolocation = useCurrentPosition();

  async function locateMe() {
    const position = await geolocation.locate();
    if (position) setPin(position.point);
  }

  async function onSubmit(values: SavedAddressValues) {
    setSaving(true);
    setError(null);
    try {
      const body = toSavedAddressInput(values, pin);
      const result = address ? await customersApi.updateAddress(address.id, body) : await customersApi.createAddress(body);
      toast.success(address ? "Guardamos los cambios" : `Guardamos «${result.label}»`);
      onSaved(result);
    } catch (failure) {
      setSaving(false);
      if (hasCode(failure, "ADDRESS_LABEL_TAKEN")) form.setError("label", { message: failure.message });
      else setError(failure);
    }
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" aria-label="Dirección">
      <DialogHeader>
        <DialogTitle>{address ? "Editar dirección" : "Nueva dirección"}</DialogTitle>
        <DialogDescription>La verás en «Mis direcciones» al pedir delivery.</DialogDescription>
      </DialogHeader>
      <FormField id="address-label" label="Nombre" error={errors.label?.message} description="Ej. Casa, Trabajo, Donde mi mamá.">
        {(control) => <Input {...control} maxLength={CUSTOMER_LIMITS.addressLabelMax} aria-required {...form.register("label")} />}
      </FormField>
      <FormField id="address-street" label="Calle y número" error={errors.address?.message}>
        {(control) => (
          <Input
            {...control}
            autoComplete="address-line1"
            placeholder="Ej. Av. Italia 1234"
            maxLength={ORDER_LIMITS.addressMax}
            aria-required
            {...form.register("address")}
          />
        )}
      </FormField>
      <FormField id="address-unit" label="Depto, casa u oficina (opcional)" error={errors.unit?.message}>
        {(control) => (
          <Input {...control} autoComplete="address-line2" placeholder="Ej. Depto 402" maxLength={ORDER_LIMITS.addressUnitMax} {...form.register("unit")} />
        )}
      </FormField>
      <FormField id="address-reference" label="Referencia (opcional)" error={errors.reference?.message}>
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            placeholder="Ej. portón verde, frente a la plaza"
            maxLength={ORDER_LIMITS.addressReferenceMax}
            {...form.register("reference")}
          />
        )}
      </FormField>

      {mapConfig ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Ubicación en el mapa (opcional)</legend>
          <p className="text-sm text-muted-foreground">
            Con el punto marcado, el local elige tu zona solo y el repartidor llega directo.
          </p>
          <div className="h-60 w-full">
            <PinMap config={mapConfig} pin={pin} onPinChange={setPin} label="Mapa para marcar la dirección" cooperative />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={geolocation.locating}
              aria-busy={geolocation.locating || undefined}
              onClick={() => void locateMe()}
            >
              {geolocation.locating ? <Spinner aria-hidden data-icon="inline-start" /> : <LocateFixedIcon aria-hidden data-icon="inline-start" />}
              {geolocation.locating ? "Buscando tu ubicación…" : "Usar mi ubicación"}
            </Button>
            {pin ? (
              <Button type="button" variant="ghost" onClick={() => setPin(null)}>
                Quitar punto
              </Button>
            ) : null}
          </div>
          {geolocation.error ? (
            <p className="text-sm text-destructive" role="alert">
              {GEOLOCATION_MESSAGES[geolocation.error]}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <FormError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <SubmitButton pending={saving}>{address ? "Guardar cambios" : "Guardar dirección"}</SubmitButton>
      </DialogFooter>
    </form>
  );
}
