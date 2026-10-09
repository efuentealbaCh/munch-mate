import type { MapConfig } from "@app/types";
import { Controller, Get, Headers, HttpStatus, NotFoundException, Param, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { apiError } from "../../common/errors/api-error";
import { Public } from "../auth/decorators";
import { MapsService } from "./maps.service";

const mapFileNotFound = () => new NotFoundException(apiError("MAP_FILE_NOT_FOUND", "Ese archivo del mapa no existe"));

/** Public base map: same origin as the app, so no CORS and the same path in dev and production. */
@Controller("public")
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Public()
  @Get("map-config")
  config(): Promise<MapConfig> {
    return this.maps.config();
  }

  /**
   * One map file, honoring HTTP Range (PMTiles reads a few KB per tile). A generous limit: panning a map
   * issues dozens of small requests.
   */
  @Public()
  @Throttle({ default: { limit: 3000, ttl: 60_000 } })
  @Get("maps/*path")
  async file(
    @Param("path") path: string[] | string,
    @Headers("range") range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const segments = Array.isArray(path) ? path : path.split("/");
    let object;
    try {
      object = await this.maps.read(segments, range);
    } catch (error) {
      if ((error as { name?: string }).name === "InvalidRange") {
        res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).end();
        return;
      }
      throw error;
    }
    if (!object) throw mapFileNotFound();

    res.status(object.contentRange ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK);
    res.setHeader("Content-Type", object.contentType);
    res.setHeader("Accept-Ranges", "bytes");
    // An hour: a new upload of the map (same key) is picked up soon; PMTiles also checks the ETag.
    res.setHeader("Cache-Control", "public, max-age=3600");
    if (object.contentLength !== null) res.setHeader("Content-Length", String(object.contentLength));
    if (object.contentRange) res.setHeader("Content-Range", object.contentRange);
    if (object.etag) res.setHeader("ETag", object.etag);
    object.body.on("error", () => res.destroy());
    object.body.pipe(res);
  }
}
