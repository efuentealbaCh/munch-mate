import { DELIVERY_ZONE_LIMITS, type DeliveryZoneInput, type DeliveryZoneView, type PublicDeliveryZone } from "@app/types";
import { isNameTaken } from "@app/utils";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { apiError } from "../../common/errors/api-error";
import { RestaurantsRepository } from "../restaurants/restaurants.repository";
import { type DeliveryZoneChanges, type DeliveryZoneRecord, DeliveryZonesRepository } from "./delivery-zones.repository";

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
    }));
  }

  /** @throws ConflictException ZONES_LIMIT, ZONE_NAME_TAKEN (same name ignoring case, accents and spaces). */
  async create(restaurantId: string, input: DeliveryZoneInput): Promise<DeliveryZoneView> {
    const existing = await this.zones.list(restaurantId);
    if (isNameTaken(input.name, existing)) throw zoneTaken(input.name);
    if (existing.length >= DELIVERY_ZONE_LIMITS.zonesMax) {
      throw new ConflictException(
        apiError("ZONES_LIMIT", `Puedes tener hasta ${DELIVERY_ZONE_LIMITS.zonesMax} zonas de reparto`),
      );
    }
    const zone = await this.zones.create(restaurantId, {
      name: input.name,
      fee: input.fee,
      minOrder: input.minOrder,
      active: input.active ?? true,
      isHome: input.isHome ?? false,
    });
    if (zone.isHome) await this.zones.clearHome(restaurantId, zone.id);
    return toView(zone);
  }

  /**
   * Marking a zone as home unmarks the previous one.
   * @throws NotFoundException ZONE_NOT_FOUND; ConflictException ZONE_NAME_TAKEN.
   */
  async update(restaurantId: string, zoneId: string, changes: DeliveryZoneChanges): Promise<DeliveryZoneView> {
    if (changes.name !== undefined && isNameTaken(changes.name, await this.zones.list(restaurantId), zoneId)) {
      throw zoneTaken(changes.name);
    }
    const zone = await this.zones.update(restaurantId, zoneId, changes);
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
  };
}
