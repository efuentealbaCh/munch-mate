"use client";

import type { GeoPoint, PublicDeliveryZone } from "@app/types";
import { CircleAlertIcon, CircleCheckIcon, LocateFixedIcon, ShoppingBagIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PinMap, type PinMapZone } from "@/components/map";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCurrentPosition } from "@/hooks/use-current-position";
import { useMapConfig } from "@/hooks/use-map-config";
import { publicOrdersApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { GEOLOCATION_MESSAGES, hasDrawnZones, samePoint, zoneAtPoint } from "@/lib/maps";

/** A delivery pin with the zone it fell into (null = outside every drawn zone). */
interface PinVerdict {
  pin: GeoPoint;
  zoneId: string | null;
}

/** Delay before asking the api about a pin (dragging fires several changes). */
const LOCATE_DEBOUNCE_MS = 400;
/** Above this, "Usar mi ubicación" warns that the reading is approximate (desktops on Wi-Fi). */
const APPROXIMATE_METERS = 150;

/**
 * "¿Dónde lo llevamos?" on the map (phase 7): the zones, a pin the customer drags or taps into place, and
 * "Usar mi ubicación". The pin picks the zone at once (same rule as the api: first drawn zone that contains
 * it) and the api confirms it (`locate`). Without the map (not loaded, or no zone drawn) it renders only
 * what is still useful: nothing, or the location button when the chosen zone needs a pin.
 */
export function DeliveryPinSection({
  slug,
  zones,
  selectedZone,
  center,
  pin,
  canPickup,
  onPinChange,
  onZoneFromPin,
  onChoosePickup,
}: {
  slug: string;
  zones: readonly PublicDeliveryZone[];
  selectedZone: PublicDeliveryZone | null;
  /** The restaurant's location, to start the map there. */
  center: GeoPoint | null;
  pin: GeoPoint | null;
  /** Pickup is on: offered when the pin falls outside the delivery area. */
  canPickup: boolean;
  onPinChange(pin: GeoPoint): void;
  /** The pin fell into this zone: select it in the form. */
  onZoneFromPin(zoneId: string): void;
  onChoosePickup(): void;
}) {
  const { available, config } = useMapConfig();
  const geolocation = useCurrentPosition();
  const [approximate, setApproximate] = useState<number | null>(null);
  // The api's answer for a pin; it wins over the local guess for that same pin.
  const [confirmed, setConfirmed] = useState<PinVerdict | null>(null);

  const drawn = useMemo<PinMapZone[]>(
    () => zones.filter((zone) => zone.area && zone.area.length >= 3).map((zone) => ({ id: zone.id, name: zone.name, area: zone.area! })),
    [zones],
  );
  const showMap = available && config !== null && hasDrawnZones(zones);
  const needsPin = Boolean(selectedZone?.area);

  const localZone = pin ? zoneAtPoint(pin, zones) : null;
  const pinZoneId = pin && confirmed && samePoint(confirmed.pin, pin) ? confirmed.zoneId : (localZone?.id ?? null);
  const pinZone = zones.find((zone) => zone.id === pinZoneId) ?? null;

  // Confirm with the api (debounced, latest pin only). A network failure keeps the local guess: the api
  // checks the pin again when the order is sent.
  const onZoneRef = useRef(onZoneFromPin);
  useEffect(() => {
    onZoneRef.current = onZoneFromPin;
  });
  const pinLat = pin?.lat;
  const pinLng = pin?.lng;
  const hasDrawn = drawn.length > 0;
  useEffect(() => {
    if (pinLat === undefined || pinLng === undefined || !hasDrawn) return;
    const point = { lat: pinLat, lng: pinLng };
    const local = zoneAtPoint(point, zones);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      publicOrdersApi.locateZone(slug, point, controller.signal).then(
        (zone) => {
          setConfirmed({ pin: point, zoneId: zone.id });
          // The api knows better (e.g. an area edited after the zones loaded).
          if (zone.id !== local?.id) onZoneRef.current(zone.id);
        },
        (failure: unknown) => {
          if (hasCode(failure, "OUT_OF_DELIVERY_AREA")) setConfirmed({ pin: point, zoneId: null });
        },
      );
    }, LOCATE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pinLat, pinLng, slug, zones, hasDrawn]);

  /** The customer placed the pin (map or geolocation): select its zone right away. */
  function place(point: GeoPoint) {
    onPinChange(point);
    const zone = zoneAtPoint(point, zones);
    if (zone) onZoneFromPin(zone.id);
  }

  async function locateMe() {
    const position = await geolocation.locate();
    if (!position) return;
    setApproximate(position.accuracy > APPROXIMATE_METERS ? position.accuracy : null);
    place(position.point);
  }

  if (!showMap && !needsPin) return null;

  return (
    <div className="clear-left flex flex-col gap-2" data-testid="delivery-pin">
      {showMap ? (
        <>
          <p className="text-sm text-muted-foreground">
            Toca el mapa o arrastra el pin hasta tu puerta. Elegimos la zona según el punto.
          </p>
          <div className="h-60 w-full">
            <PinMap
              config={config}
              center={center}
              zones={drawn}
              selectedZoneId={pinZoneId}
              pin={pin}
              onPinChange={(point) => {
                setApproximate(null);
                place(point);
              }}
              label="Mapa para marcar dónde entregar"
              cooperative
            />
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {selectedZone?.name} necesita tu ubicación exacta. Usa la de tu teléfono estando en el lugar de entrega.
        </p>
      )}
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
        <p className="text-sm text-destructive" role="alert" data-testid="geolocation-error">
          {GEOLOCATION_MESSAGES[geolocation.error]}
        </p>
      ) : null}
      {approximate !== null ? (
        <p className="text-sm text-muted-foreground" role="status">
          Tu ubicación es aproximada (± {approximate.toLocaleString("es-CL")} m): ajusta el pin si hace falta.
        </p>
      ) : null}
      <div aria-live="polite">
        {pin && pinZone && pinZone.id === selectedZone?.id ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success" data-testid="pin-zone">
            <CircleCheckIcon className="size-4 shrink-0" aria-hidden />
            Entregamos en {pinZone.name}
          </p>
        ) : pin && pinZone ? (
          // The customer picked another zone by name after placing the pin.
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="pin-zone-other">
            Tu punto está en {pinZone.name}.
            <Button type="button" size="sm" variant="outline" onClick={() => onZoneFromPin(pinZone.id)}>
              Elegir {pinZone.name}
            </Button>
          </p>
        ) : pin && drawn.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground" data-testid="pin-outside">
            <p className="flex items-start gap-2">
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <strong>El local no reparte ahí.</strong>{" "}
                {zones.some((zone) => !zone.area) ? "Si tu comuna aparece en la lista de abajo, elígela; si no, " : ""}
                revisa el punto en el mapa.
              </span>
            </p>
            {canPickup ? (
              <Button type="button" size="sm" variant="outline" className="self-start bg-background" onClick={onChoosePickup}>
                <ShoppingBagIcon aria-hidden data-icon="inline-start" />
                Prefiero retirar en el local
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
