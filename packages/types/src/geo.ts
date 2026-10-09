/** A point on the map (WGS84 degrees). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Vertices of a delivery zone drawn on the map, in order, without repeating the first one at the end. */
export type GeoArea = GeoPoint[];

export const GEO_LIMITS = {
  zoneVerticesMin: 3,
  zoneVerticesMax: 200,
  /** Coordinates are stored rounded to 6 decimals (~10 cm): enough for a door, no false precision. */
  decimals: 6,
  /** The rider's phone reports at most once every this many seconds; extra reports are ignored. */
  riderReportMinSeconds: 3,
  /** A rider position older than this is no longer shown. */
  riderPositionTtlSeconds: 15 * 60,
} as const;

/** Where the web loads the base map from (served by the api from the private bucket). */
export interface MapConfig {
  /** False until the map data is uploaded (`pnpm maps:init`): the web falls back to the zone list. */
  available: boolean;
  /** PMTiles archive, read with HTTP range requests. */
  tilesUrl: string;
  /** MapLibre glyphs template ({fontstack}/{range}.pbf). */
  glyphsUrl: string;
  /** MapLibre sprite base URL (without .json/.png). */
  spriteUrl: string;
  attribution: string;
}

/** Last known position of the rider of a delivery that is on its way. */
export interface RiderPosition {
  lat: number;
  lng: number;
  /** Meters, as reported by the phone. */
  accuracy: number | null;
  /** ISO time of the report. */
  at: string;
}
