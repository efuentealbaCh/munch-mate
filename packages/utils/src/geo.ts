import { type GeoArea, GEO_LIMITS, type GeoPoint } from "@app/types";

/** Rounds a coordinate to GEO_LIMITS.decimals (~10 cm). */
export function roundCoord(value: number): number {
  const factor = 10 ** GEO_LIMITS.decimals;
  return Math.round(value * factor) / factor;
}

/** Whether a value is a usable point: finite numbers inside the WGS84 ranges. */
export function isGeoPoint(value: unknown): value is GeoPoint {
  const p = value as Partial<GeoPoint> | null;
  return (
    typeof p?.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

export type GeoAreaProblem = "vertices" | "coordinates" | "repeated";

/**
 * Checks a zone drawn on the map: 3–200 valid vertices, no two consecutive ones at the same spot.
 * Self-crossing shapes are rejected by MongoDB when saving (the api maps it to the same error).
 * @returns The first problem, or null when valid.
 */
export function geoAreaProblem(area: unknown): GeoAreaProblem | null {
  if (!Array.isArray(area) || area.length < GEO_LIMITS.zoneVerticesMin || area.length > GEO_LIMITS.zoneVerticesMax) {
    return "vertices";
  }
  if (!area.every(isGeoPoint)) return "coordinates";
  const points = area as GeoArea;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    if (roundCoord(a.lat) === roundCoord(b.lat) && roundCoord(a.lng) === roundCoord(b.lng)) return "repeated";
  }
  return null;
}

/**
 * Whether a point is inside an area (ray casting on lat/lng, fine at city scale). The api decides with
 * MongoDB's $geoIntersects; the web uses this to react instantly while the pin moves.
 */
export function isPointInArea(point: GeoPoint, area: GeoArea): boolean {
  let inside = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const a = area[i]!;
    const b = area[j]!;
    const crosses = a.lat > point.lat !== b.lat > point.lat;
    if (crosses && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}
