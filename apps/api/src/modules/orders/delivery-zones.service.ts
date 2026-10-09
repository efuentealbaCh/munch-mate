import {
  DELIVERY_ZONE_LIMITS,
  type DeliveryZoneInput,
  type DeliveryZoneView,
  type GeoArea,
  type GeoPoint,
  type PublicDeliveryZone,
} from "@app/types";
import { type GeoAreaProblem, geoAreaProblem, isNameTaken } from "@app/utils";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { apiError } from "../../common/errors/api-error";
import { RestaurantsRepository } from "../restaurants/restaurants.repository";
import {
  type DeliveryZoneChanges,
  type DeliveryZoneRecord,
  DeliveryZonesRepository,
  InvalidAreaError,
} from "./delivery-zones.repository";

const AREA_MESSAGES: Record<GeoAreaProblem | "crossing", string> = {
  vertices: "Dibuja la zona con al menos 3 puntos (máximo 200)",
  coordinates: "Hay puntos de la zona fuera del mapa",
  repeated: "Hay dos puntos seguidos en el mismo lugar; quita uno",
  crossing: "Los bordes de la zona se cruzan; dibújala sin que se crucen",
};
const invalidArea = (problem: keyof typeof AREA_MESSAGES) =>
  new BadRequestException(apiError("INVALID_ZONE_AREA", AREA_MESSAGES[problem]));

/** Validates an area before saving (null/undefined pass: removing it or leaving it as is). */
function checkArea(area: GeoArea | null | undefined): void {
  if (area === null || area === undefined) return;
  const problem = geoAreaProblem(area);
  if (problem) throw invalidArea(problem);
}

const zoneNotFound = () => new NotFoundException(apiError("ZONE_NOT_FOUND", "Esa zona de reparto no existe"));
const zoneTaken = (name: string) =>
  new ConflictException(apiError("ZONE_NAME_TAKEN", `Ya tienes una zona llamada «${name}»; edítala en vez de crear otra`));

/** Owner-managed list of communes/sectors with fee and minimum order. */
@Injectable()
export class DeliveryZonesService {
  constructor(
    private readonly zones: DeliveryZonesRepository,
    private readonly restaurants: RestaurantsRepository,
  ) {}

  async list(restaurantId: string): Promise<DeliveryZoneView[]> {
    return (await this.zones.list(restaurantId)).map(toView);
  }

  /**
   * Zones a customer can pick at checkout: active only, the restaurant's own commune first.
   * @throws NotFoundException MENU_NOT_FOUND (unknown or suspended restaurant), DELIVERY_DISABLED.
   */
  async listPublic(slug: string): Promise<PublicDeliveryZone[]> {
    const restaurant = await this.restaurants.findBySlug(slug.trim().toLowerCase());
    if (!restaurant || restaurant.status !== "active") {
      throw new NotFoundException(apiError("MENU_NOT_FOUND", "No encontramos ese restaurante"));
    }
    if (!restaurant.deliveryEnabled) {
      throw new NotFoundException(apiError("DELIVERY_DISABLED", "Este local no hace despacho a domicilio"));
    }
    const zones = await this.zones.list(restaurant.id, { activeOnly: true });
    return [...zones.filter((z) => z.isHome), ...zones.filter((z) => !z.isHome)].map((z) => ({
      id: z.id,
      name: z.name,
      fee: z.fee,
      minOrder: z.minOrder,
      isHome: z.isHome,
      area: z.area,
    }));
  }

  /**
   * The zone a customer's pin falls into (first in the owner's order when areas overlap). Only zones with an
   * area drawn take part.
   * @throws NotFoundException MENU_NOT_FOUND, DELIVERY_DISABLED, OUT_OF_DELIVERY_AREA.
   */
  async locatePublic(slug: string, point: GeoPoint): Promise<PublicDeliveryZone> {
    const restaurant = await this.restaurants.findBySlug(slug.trim().toLowerCase());
    if (!restaurant || restaurant.status !== "active") {
      throw new NotFoundException(apiError("MENU_NOT_FOUND", "No encontramos ese restaurante"));
    }
    if (!restaurant.deliveryEnabled) {
      throw new NotFoundException(apiError("DELIVERY_DISABLED", "Este local no hace despacho a domicilio"));
    }
    const [zone] = await this.zones.locate(restaurant.id, point);
    if (!zone) {
      throw new NotFoundException(
        apiError("OUT_OF_DELIVERY_AREA", "El local no reparte en esa ubicación. Puedes pedir para retirar."),
      );
    }
    return { id: zone.id, name: zone.name, fee: zone.fee, minOrder: zone.minOrder, isHome: zone.isHome, area: zone.area };
  }

  /**
   * @throws ConflictException ZONES_LIMIT, ZONE_NAME_TAKEN (same name ignoring case, accents and spaces);
   *   BadRequestException INVALID_ZONE_AREA.
   */
  async create(restaurantId: string, input: DeliveryZoneInput): Promise<DeliveryZoneView> {
    checkArea(input.area);
    const existing = await this.zones.list(restaurantId);
    if (isNameTaken(input.name, existing)) throw zoneTaken(input.name);
    if (existing.length >= DELIVERY_ZONE_LIMITS.zonesMax) {
      throw new ConflictException(
        apiError("ZONES_LIMIT", `Puedes tener hasta ${DELIVERY_ZONE_LIMITS.zonesMax} zonas de reparto`),
      );
    }
    let zone: DeliveryZoneRecord;
    try {
      zone = await this.zones.create(restaurantId, {
        name: input.name,
        fee: input.fee,
        minOrder: input.minOrder,
        active: input.active ?? true,
        isHome: input.isHome ?? false,
        area: input.area ?? null,
      });
    } catch (error) {
      if (error instanceof InvalidAreaError) throw invalidArea("crossing");
      throw error;
    }
    if (zone.isHome) await this.zones.clearHome(restaurantId, zone.id);
    return toView(zone);
  }

  /**
   * Marking a zone as home unmarks the previous one.
   * @throws NotFoundException ZONE_NOT_FOUND; ConflictException ZONE_NAME_TAKEN; BadRequestException INVALID_ZONE_AREA.
   */
  async update(restaurantId: string, zoneId: string, changes: DeliveryZoneChanges): Promise<DeliveryZoneView> {
    checkArea(changes.area);
    if (changes.name !== undefined && isNameTaken(changes.name, await this.zones.list(restaurantId), zoneId)) {
      throw zoneTaken(changes.name);
    }
    let zone: DeliveryZoneRecord | null;
    try {
      zone = await this.zones.update(restaurantId, zoneId, changes);
    } catch (error) {
      if (error instanceof InvalidAreaError) throw invalidArea("crossing");
      throw error;
    }
    if (!zone) throw zoneNotFound();
    if (changes.isHome) await this.zones.clearHome(restaurantId, zone.id);
    return toView(zone);
  }

  /** @throws NotFoundException ZONE_NOT_FOUND. */
  async delete(restaurantId: string, zoneId: string): Promise<void> {
    if (!(await this.zones.delete(restaurantId, zoneId))) throw zoneNotFound();
  }
}

function toView(zone: DeliveryZoneRecord): DeliveryZoneView {
  return {
    id: zone.id,
    name: zone.name,
    fee: zone.fee,
    minOrder: zone.minOrder,
    active: zone.active,
    isHome: zone.isHome,
    position: zone.position,
    area: zone.area,
  };
}
