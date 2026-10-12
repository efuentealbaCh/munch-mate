"use client";

import type { DeliveryZoneView, GeoPoint, MapConfig } from "@app/types";
import { geoAreaProblem } from "@app/utils";
import { EraserIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useReducer, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { AreaEditorMap } from "@/components/map";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deliveryZonesApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";
import { areaEditorReducer, areaProblemMessage, initialAreaEditor } from "@/lib/maps";

interface ZoneAreaDialogProps {
  restaurantId: string;
  /** The zone being drawn; null = closed. */
  zone: DeliveryZoneView | null;
  /** Every zone (the others are drawn in gray for reference). */
  zones: readonly DeliveryZoneView[];
  config: MapConfig;
  center: GeoPoint | null;
  onOpenChange(open: boolean): void;
  onSaved(zone: DeliveryZoneView): void;
  onStale(): void;
}

/** "Dibujar en el mapa" / "Editar área" of a delivery zone. */
export function ZoneAreaDialog({ zone, onOpenChange, ...props }: ZoneAreaDialogProps) {
  return (
    <Dialog open={zone !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-3xl">
        {/* Remounted on every open, so the editor starts from the stored area. */}
        {zone ? <AreaEditor key={zone.id} zone={zone} {...props} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AreaEditor({
  restaurantId,
  zone,
  zones,
  config,
  center,
  onSaved,
  onStale,
  onClose,
}: Omit<ZoneAreaDialogProps, "zone" | "onOpenChange"> & { zone: DeliveryZoneView; onClose(): void }) {
  const [state, dispatch] = useReducer(areaEditorReducer, zone.area, initialAreaEditor);
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { points } = state;
  const problem = areaProblemMessage(geoAreaProblem(points), points.length);
  const others = zones.filter((z) => z.id !== zone.id && z.area !== null).map((z) => ({ name: z.name, area: z.area! }));

  function edit(action: Parameters<typeof dispatch>[0]) {
    setError(null);
    setSelected(null);
    dispatch(action);
  }

  async function save() {
    if (problem) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await deliveryZonesApi.update(restaurantId, zone.id, { area: points });
      onSaved(saved);
      toast.success(zone.area ? `Área de «${zone.name}» actualizada` : `«${zone.name}» ya está dibujada en el mapa`);
      onClose();
    } catch (failure) {
      setSaving(false);
      if (hasCode(failure, "ZONE_NOT_FOUND")) {
        toast.error(failure.message);
        onStale();
        onClose();
        return;
      }
      // INVALID_ZONE_AREA (bordes que se cruzan) and the rest: the api's message.
      setError(failure);
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
        <DialogTitle>Área de reparto · {zone.name}</DialogTitle>
        <DialogDescription>
          Toca el mapa para agregar puntos alrededor de la zona. Arrastra un punto para moverlo o tócalo para seleccionarlo. Las otras
          zonas se ven en gris.
        </DialogDescription>
      </DialogHeader>
      <div className="h-[50dvh] min-h-64 w-full">
        <AreaEditorMap
          config={config}
          center={center}
          points={points}
          others={others}
          selected={selected}
          onAdd={(point) => edit({ type: "add", point })}
          onMove={(index, point) => edit({ type: "move", index, point })}
          onSelect={(index) => setSelected((current) => (current === index ? null : index))}
          label={`Mapa para dibujar el área de ${zone.name}`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Herramientas del área">
        <Button type="button" size="sm" variant="outline" disabled={state.history.length === 0} onClick={() => edit({ type: "undo" })}>
          <Undo2Icon aria-hidden data-icon="inline-start" />
          Deshacer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={selected === null}
          onClick={() => selected !== null && edit({ type: "remove", index: selected })}
        >
          <Trash2Icon aria-hidden data-icon="inline-start" />
          Quitar punto
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={points.length === 0} onClick={() => edit({ type: "clear" })}>
          <EraserIcon aria-hidden data-icon="inline-start" />
          Limpiar
        </Button>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums" data-testid="area-vertices">
          {points.length} {points.length === 1 ? "punto" : "puntos"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {problem ?? "Listo para guardar. Los clientes que marquen su ubicación dentro del área quedan en esta zona."}
      </p>
      <FormError error={error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <SubmitButton pending={saving} disabled={problem !== null}>
          Guardar área
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
