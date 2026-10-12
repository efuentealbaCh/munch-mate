"use client";

import type { GeoPoint, MapConfig } from "@app/types";
import { LocateFixedIcon, MapPinIcon, MapPinOffIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormError } from "@/components/form-error";
import { PinMap } from "@/components/map";
import { MapUnavailableNotice } from "@/components/map-unavailable-notice";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useCurrentPosition } from "@/hooks/use-current-position";
import { useMapConfig } from "@/hooks/use-map-config";
import { restaurantsApi } from "@/lib/endpoints";
import { errorMessage, hasCode } from "@/lib/errors";
import { GEOLOCATION_MESSAGES } from "@/lib/maps";
import { useRestaurant } from "./restaurant-context";

/**
 * Owner card "Ubicación del local" (phase 7): a pin that centers the delivery and tracking maps. Optional;
 * without the map data it only explains why it cannot be set (and still lets the owner remove an old one).
 */
export function LocationSettings() {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const map = useMapConfig();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const location = restaurant.location;

  async function remove() {
    setRemoving(true);
    try {
      setRestaurant(await restaurantsApi.update(restaurant.id, { location: null }));
      toast.success("Quitaste la ubicación del local");
    } catch (failure) {
      toast.error(errorMessage(failure));
      if (hasCode(failure, "FORBIDDEN_ROLE")) reload();
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  }

  if (map.status === "loading") return <Skeleton className="h-16 w-full" aria-busy="true" aria-label="Cargando mapa" />;

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-sm" data-testid="restaurant-location">
        {location ? (
          <MapPinIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        ) : (
          <MapPinOffIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span>
          {location ? (
            <>
              Tu local está ubicado en el mapa{" "}
              <span className="text-muted-foreground tabular-nums">
                ({location.lat.toFixed(5)}, {location.lng.toFixed(5)})
              </span>
              .
            </>
          ) : (
            "Tu local todavía no está en el mapa. Ubícalo para que los mapas de delivery partan desde ahí."
          )}
        </span>
      </p>
      {map.available ? null : <MapUnavailableNotice>Podrás ubicar tu local cuando esté listo.</MapUnavailableNotice>}
      <div className="flex flex-wrap gap-2">
        {map.available ? (
          <Button variant="outline" disabled={restaurant.status === "suspended"} onClick={() => setEditing(true)}>
            <MapPinIcon aria-hidden data-icon="inline-start" />
            {location ? "Cambiar ubicación" : "Ubicar en el mapa"}
          </Button>
        ) : null}
        {location ? (
          <Button variant="ghost" disabled={restaurant.status === "suspended"} onClick={() => setConfirmRemove(true)}>
            Quitar ubicación
          </Button>
        ) : null}
      </div>

      {map.available && map.config ? (
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-2xl">
            {editing ? <LocationEditor config={map.config} onClose={() => setEditing(false)} /> : null}
          </DialogContent>
        </Dialog>
      ) : null}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="¿Quitar la ubicación del local?"
        description="Los mapas volverán a partir desde el centro de Santiago. Las zonas de reparto no cambian."
        confirmLabel="Quitar"
        destructive
        pending={removing}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

function LocationEditor({ config, onClose }: { config: MapConfig; onClose(): void }) {
  const { restaurant, setRestaurant, reload } = useRestaurant();
  const [pin, setPin] = useState<GeoPoint | null>(restaurant.location);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const geolocation = useCurrentPosition();

  async function locateMe() {
    const position = await geolocation.locate();
    if (position) setPin(position.point);
  }

  async function save() {
    if (!pin) return;
    setSaving(true);
    setError(null);
    try {
      setRestaurant(await restaurantsApi.update(restaurant.id, { location: pin }));
      toast.success("Guardamos la ubicación del local");
      onClose();
    } catch (failure) {
      setSaving(false);
      setError(failure);
      if (hasCode(failure, "FORBIDDEN_ROLE")) reload();
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>Ubicación del local</DialogTitle>
        <DialogDescription>Toca el mapa o arrastra el pin hasta la puerta de tu local.</DialogDescription>
      </DialogHeader>
      <div className="h-[50dvh] min-h-64 w-full">
        <PinMap config={config} center={restaurant.location} pin={pin} onPinChange={setPin} label="Mapa para ubicar el local" />
      </div>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={geolocation.locating}
        aria-busy={geolocation.locating || undefined}
        onClick={() => void locateMe()}
      >
        {geolocation.locating ? <Spinner aria-hidden data-icon="inline-start" /> : <LocateFixedIcon aria-hidden data-icon="inline-start" />}
        {geolocation.locating ? "Buscando tu ubicación…" : "Usar mi ubicación"}
      </Button>
      {geolocation.error ? (
        <p className="text-sm text-destructive" role="alert">
          {GEOLOCATION_MESSAGES[geolocation.error]}
        </p>
      ) : null}
      {pin ? null : (
        <p className="text-sm text-muted-foreground" role="status">
          Marca un punto para poder guardar.
        </p>
      )}
      <FormError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <SubmitButton pending={saving} disabled={!pin}>
          Guardar ubicación
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
