import type { MapConfig } from "@app/types";
import { Injectable } from "@nestjs/common";
import { type PrivateObjectStream, StorageService } from "../../infra/storage/storage.service";

/** Private-bucket prefix of the map data uploaded by `pnpm maps:init`. */
export const MAPS_PREFIX = "maps";
export const MAP_ARCHIVE = "chile.pmtiles";
const AVAILABILITY_TTL_MS = 60_000;

// A path segment: letters, digits, spaces (font names) and . _ , + - ; never "." or ".." alone.
const SEGMENT = /^[A-Za-z0-9 _.,+@-]{1,100}$/;
const ALLOWED_ROOTS = [MAP_ARCHIVE, "fonts", "sprites"];

/**
 * Base map served from our own storage (no map provider, no API key): a PMTiles archive of Chile plus the
 * fonts and sprites of the Protomaps basemap style.
 */
@Injectable()
export class MapsService {
  private availability: { value: boolean; checkedAt: number } | null = null;

  constructor(private readonly storage: StorageService) {}

  /** Where the web loads the map from; `available` is false until the data is uploaded. */
  async config(): Promise<MapConfig> {
    return {
      available: await this.isAvailable(),
      tilesUrl: `/api/public/maps/${MAP_ARCHIVE}`,
      glyphsUrl: "/api/public/maps/fonts/{fontstack}/{range}.pbf",
      spriteUrl: "/api/public/maps/sprites/v4/light",
      attribution: '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>',
    };
  }

  /**
   * Reads a map file, or a byte range of it.
   * @param path Segments after `/maps/`; anything outside the map files is refused (null).
   * @returns null for unknown or refused paths.
   */
  async read(path: readonly string[], range?: string): Promise<PrivateObjectStream | null> {
    if (!isMapPath(path)) return null;
    return this.storage.getPrivateStream(`${MAPS_PREFIX}/${path.join("/")}`, range);
  }

  /** Whether the map data is uploaded (cached for a minute). */
  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.availability && now - this.availability.checkedAt < AVAILABILITY_TTL_MS) return this.availability.value;
    const value = await this.storage.existsPrivate(`${MAPS_PREFIX}/${MAP_ARCHIVE}`);
    this.availability = { value, checkedAt: now };
    return value;
  }
}

/** Only the archive, fonts/… and sprites/…, with safe segments (no traversal, no other bucket keys). */
export function isMapPath(path: readonly string[]): boolean {
  if (path.length === 0 || path.length > 4 || !ALLOWED_ROOTS.includes(path[0]!)) return false;
  if (path[0] === MAP_ARCHIVE && path.length !== 1) return false;
  return path.every((segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..");
}
