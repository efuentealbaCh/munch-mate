import { MapIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Owner-facing note while the self-hosted map has no data yet (`map-config.available` false). Informative
 * only: everything keeps working without the map.
 */
export function MapUnavailableNotice({ children }: { children?: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" role="note" data-testid="map-unavailable">
      <MapIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        El mapa todavía no está disponible: se activa cuando se cargan sus datos en el servidor (<code className="font-mono">pnpm maps:init</code>).{" "}
        {children}
      </span>
    </p>
  );
}
