import { type GeoArea, GEO_LIMITS, type GeoPoint, type PublicDeliveryZone, type RiderPosition } from "@app/types";
import { type GeoAreaProblem, isPointInArea } from "@app/utils";

/**
 * Pure helpers of the maps (phase 7): URLs of the self-hosted base map, choosing the zone of a pin,
 * framing points, the polygon editor, rider report pacing and "hace N s" labels. No MapLibre here, so it
 * is unit-tested and cheap to import from any page.
 */

/** Santiago centro: where maps start when the restaurant has no location yet. */
export const DEFAULT_CENTER: GeoPoint = { lat: -33.4489, lng: -70.6693 };
export const DEFAULT_ZOOM = 12;
/** Zoom used when focusing a single point (a pin, the rider). */
export const POINT_ZOOM = 16;

/** The rider's phone sends at most one report every this many ms (the api drops reports < 3 s apart). */
export const RIDER_REPORT_INTERVAL_MS = 5_000;
/** A rider position older than this is shown with a warning ("puede haber perdido señal"). */
export const RIDER_STALE_MS = 2 * 60_000;

// ── Base map URLs ───────────────────────────────────────────────────────────

/**
 * Absolute URL for a map resource the api gave as a path ("/api/public/maps/…"). MapLibre and the pmtiles
 * protocol need absolute URLs; `new URL()` cannot be used because it would percent-encode the
 * `{fontstack}`/`{range}` placeholders of the glyphs template.
 */
export function absoluteMapUrl(path: string, origin: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

// ── Zones and pins ──────────────────────────────────────────────────────────

/** Whether the map is worth showing at checkout: at least one zone has an area drawn. */
export function hasDrawnZones(zones: readonly Pick<PublicDeliveryZone, "area">[]): boolean {
  return zones.some((zone) => zone.area !== null && zone.area.length >= GEO_LIMITS.zoneVerticesMin);
}

/**
 * The zone that contains a pin, like the api decides it: the first one in display order when areas overlap.
 * Only zones with an area take part (zones without one are chosen by name).
 * @returns The zone, or null when the pin is outside every drawn zone.
 */
export function zoneAtPoint<Z extends Pick<PublicDeliveryZone, "area">>(point: GeoPoint, zones: readonly Z[]): Z | null {
  return zones.find((zone) => zone.area !== null && zone.area.length >= 3 && isPointInArea(point, zone.area)) ?? null;
}

export type PinProblem = "missing" | "outside-zone";

/**
 * What blocks a delivery order on the pin side (mirrors the api's LOCATION_REQUIRED / OUTSIDE_ZONE).
 * Zones without an area never need a pin.
 */
export function pinProblem(zone: Pick<PublicDeliveryZone, "area"> | null | undefined, pin: GeoPoint | null): PinProblem | null {
  if (!zone?.area || zone.area.length < 3) return null;
  if (!pin) return "missing";
  return isPointInArea(pin, zone.area) ? null : "outside-zone";
}

/** Same point after rounding to the stored precision (avoids re-asking the api for an unmoved pin). */
export function samePoint(a: GeoPoint | null | undefined, b: GeoPoint | null | undefined): boolean {
  if (!a || !b) return a === b;
  const factor = 10 ** GEO_LIMITS.decimals;
  return Math.round(a.lat * factor) === Math.round(b.lat * factor) && Math.round(a.lng * factor) === Math.round(b.lng * factor);
}

// ── Framing ─────────────────────────────────────────────────────────────────

/** [[west, south], [east, north]], the shape MapLibre's fitBounds takes. */
export type LngLatBox = [[number, number], [number, number]];

/** Smallest box containing every point; null without points. A single point gives a zero-size box. */
export function boundsOf(points: readonly GeoPoint[]): LngLatBox | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { lat, lng } of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

/** Whether a point lies inside a box (edges included). */
export function boxContains(box: LngLatBox, point: GeoPoint): boolean {
  const [[west, south], [east, north]] = box;
  return point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north;
}

/** Vertices of every drawn zone, flattened (to frame them all). */
export function areaPoints(zones: readonly Pick<PublicDeliveryZone, "area">[]): GeoPoint[] {
  return zones.flatMap((zone) => zone.area ?? []);
}

// ── Polygon editor ──────────────────────────────────────────────────────────

const distance = (a: GeoPoint, b: GeoPoint) => Math.hypot(a.lat - b.lat, a.lng - b.lng);

/**
 * Where a new vertex goes: with fewer than 3 vertices, at the end; otherwise on the edge whose detour is
 * shortest, so tapping next to a side of an existing area widens that side instead of crossing the shape.
 */
export function insertionIndex(area: readonly GeoPoint[], point: GeoPoint): number {
  if (area.length < 3) return area.length;
  let best = area.length;
  let bestCost = Infinity;
  for (let i = 0; i < area.length; i++) {
    const a = area[i]!;
    const b = area[(i + 1) % area.length]!;
    const cost = distance(a, point) + distance(point, b) - distance(a, b);
    if (cost < bestCost) {
      bestCost = cost;
      best = i + 1;
    }
  }
  return best;
}

export interface AreaEditorState {
  points: GeoArea;
  /** Previous versions, newest last (for "Deshacer"). */
  history: GeoArea[];
}

export type AreaEditorAction =
  | { type: "add"; point: GeoPoint }
  | { type: "move"; index: number; point: GeoPoint }
  | { type: "remove"; index: number }
  | { type: "undo" }
  | { type: "clear" };

const HISTORY_MAX = 100;

export function initialAreaEditor(area: GeoArea | null | undefined): AreaEditorState {
  return { points: area ? [...area] : [], history: [] };
}

/** Reducer of the zone area editor. Every change can be undone; clearing too. */
export function areaEditorReducer(state: AreaEditorState, action: AreaEditorAction): AreaEditorState {
  const commit = (points: GeoArea): AreaEditorState => ({ points, history: [...state.history, state.points].slice(-HISTORY_MAX) });
  switch (action.type) {
    case "add": {
      if (state.points.length >= GEO_LIMITS.zoneVerticesMax) return state;
      const index = insertionIndex(state.points, action.point);
      const points = [...state.points];
      points.splice(index, 0, action.point);
      return commit(points);
    }
    case "move": {
      if (!state.points[action.index]) return state;
      return commit(state.points.map((p, i) => (i === action.index ? action.point : p)));
    }
    case "remove": {
      if (!state.points[action.index]) return state;
      return commit(state.points.filter((_, i) => i !== action.index));
    }
    case "undo": {
      const previous = state.history.at(-1);
      return previous ? { points: previous, history: state.history.slice(0, -1) } : state;
    }
    case "clear":
      return state.points.length === 0 ? state : commit([]);
  }
}

/** Spanish text for geoAreaProblem (null when the area is fine). */
export function areaProblemMessage(problem: GeoAreaProblem | null, vertices: number): string | null {
  switch (problem) {
    case null:
      return null;
    case "vertices":
      return vertices < GEO_LIMITS.zoneVerticesMin
        ? `Marca al menos ${GEO_LIMITS.zoneVerticesMin} puntos en el mapa (llevas ${vertices}).`
        : `El área puede tener hasta ${GEO_LIMITS.zoneVerticesMax} puntos.`;
    case "coordinates":
      return "Hay un punto fuera del mapa. Deshaz el último cambio.";
    case "repeated":
      return "Hay dos puntos seguidos en el mismo lugar. Mueve o deshaz uno.";
  }
}

// ── Rider reports ───────────────────────────────────────────────────────────

/**
 * How long to wait before sending the next position report.
 * @param lastSentAt When the previous report went out (ms), or null if none yet.
 * @returns 0 = send now; otherwise the ms left (the caller sends the newest fix when it elapses).
 */
export function reportDelay(lastSentAt: number | null, now: number, intervalMs = RIDER_REPORT_INTERVAL_MS): number {
  if (lastSentAt === null) return 0;
  const elapsed = now - lastSentAt;
  // A clock that went backwards (device time change) must not freeze the reports.
  if (elapsed < 0) return 0;
  return Math.max(0, intervalMs - elapsed);
}

// ── "hace N s" ──────────────────────────────────────────────────────────────

/** "hace un momento", "hace 12 s", "hace 3 min", "hace 2 h" (negative ages, from clock skew, count as now). */
export function formatAgo(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 5) return "hace un momento";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

/** A rider position as the page keeps it: `seenAt` is a LOCAL clock time, so device clock skew does not lie. */
export interface TrackedPosition extends RiderPosition {
  seenAt: number;
}

/**
 * Stamps a position with the local time it stands for: live events are as old as their arrival; a position
 * read over REST is dated with its report time, but never in the future (device clock behind the server).
 */
export function trackPosition(position: RiderPosition, now: number, live: boolean): TrackedPosition {
  const reported = Date.parse(position.at);
  const seenAt = live || !Number.isFinite(reported) ? now : Math.min(reported, now);
  return { ...position, seenAt };
}

export function isStalePosition(position: Pick<TrackedPosition, "seenAt">, now: number): boolean {
  return now - position.seenAt > RIDER_STALE_MS;
}

// ── Geolocation errors ──────────────────────────────────────────────────────

/** Codes of GeolocationPositionError, plus the cases where the API cannot even be asked. */
export type GeolocationFailure = "denied" | "unavailable" | "timeout" | "unsupported" | "insecure";

export function geolocationFailure(error: { code: number }): GeolocationFailure {
  if (error.code === 1) return "denied";
  if (error.code === 3) return "timeout";
  return "unavailable";
}

export const GEOLOCATION_MESSAGES: Record<GeolocationFailure, string> = {
  denied: "No diste permiso para usar tu ubicación. Actívalo en los ajustes del navegador o mueve el pin a mano.",
  unavailable: "No pudimos obtener tu ubicación (GPS sin señal o apagado). Intenta de nuevo o mueve el pin a mano.",
  timeout: "Tu ubicación está tardando demasiado. Intenta de nuevo o mueve el pin a mano.",
  unsupported: "Tu navegador no permite compartir la ubicación. Mueve el pin a mano.",
  insecure: "La ubicación solo funciona en una conexión segura (https). Mueve el pin a mano.",
};

/** Messages of the ack codes of `rider.location`. */
export const RIDER_REPORT_ERRORS: Record<string, string> = {
  NOT_ON_THE_WAY: "El pedido ya no está en reparto: dejamos de compartir tu ubicación para él.",
  NOT_YOUR_DELIVERY: "Este reparto ya no está asignado a ti.",
  INVALID_POSITION: "El GPS entregó una posición inválida. Seguimos intentando.",
  ORDER_NOT_FOUND: "No encontramos el pedido.",
  UNAUTHENTICATED: "Tu sesión expiró. Recarga la página.",
};

/** Codes after which reporting for that order makes no sense anymore. */
export const RIDER_REPORT_FINAL_CODES: readonly string[] = ["NOT_ON_THE_WAY", "NOT_YOUR_DELIVERY", "ORDER_NOT_FOUND"];

/** Geolocation problems as the rider reads them (no pin to move by hand there). */
export const RIDER_GEOLOCATION_MESSAGES: Record<GeolocationFailure, string> = {
  denied: "No diste permiso para usar tu ubicación: el cliente no te verá en el mapa. Actívalo en los ajustes del navegador y recarga.",
  unavailable: "GPS sin señal o apagado. Seguimos intentando; revisa que la ubicación del teléfono esté activa.",
  timeout: "El GPS está tardando en responder. Seguimos intentando.",
  unsupported: "Este navegador no permite compartir la ubicación: el cliente no te verá en el mapa.",
  insecure: "La ubicación solo funciona en una conexión segura (https).",
};
