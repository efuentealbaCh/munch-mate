import { OPENING_HOURS_LIMITS, type RestaurantView, type SlugAvailability, type WeeklyHours } from "@app/types";
import { openingHoursProblem, slugify, slugProblem, withSuffix } from "@app/utils";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { apiError } from "../../common/errors/api-error";
import { MediaService } from "../../infra/storage/media.service";
import { RealtimeService } from "../realtime/realtime.service";
import { MembershipsRepository } from "./memberships.repository";
import type { TenantContext } from "./restaurant-access.guard";
import { normalizeRequestedSlug, OPENING_HOURS_MESSAGES, toRestaurantView } from "./restaurant.views";
import {
  type RestaurantChanges,
  type RestaurantRecord,
  RestaurantsRepository,
  SlugTakenError,
} from "./restaurants.repository";

/** Attempts to grab a generated slug before giving up, in case concurrent creations race for it. */
const MAX_SLUG_ATTEMPTS = 5;

const slugTaken = (suggestion?: string) =>
  new ConflictException(
    apiError("SLUG_TAKEN", "Esa dirección ya está en uso", suggestion ? { suggestion } : undefined),
  );

@Injectable()
export class RestaurantsService {
  constructor(
    private readonly restaurants: RestaurantsRepository,
    private readonly memberships: MembershipsRepository,
    @InjectConnection() private readonly connection: Connection,
    private readonly media: MediaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Creates a restaurant with the caller as its owner, in one transaction.
   * Without `slug`, one is derived from the name and suffixed (-2, -3…) if taken.
   * With `slug`, it is used as typed (after validation) or rejected if taken.
   * @throws BadRequestException INVALID_SLUG, ConflictException SLUG_TAKEN.
   */
  async create(ownerId: string, input: { name: string; slug?: string }): Promise<RestaurantView> {
    if (input.slug !== undefined) {
      const slug = normalizeRequestedSlug(input.slug);
      try {
        return await this.createWithOwner(ownerId, input.name, slug);
      } catch (error) {
        if (error instanceof SlugTakenError) throw slugTaken(await this.nextFreeSlug(slug));
        throw error;
      }
    }

    const base = baseSlugFor(input.name);
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        return await this.createWithOwner(ownerId, input.name, await this.nextFreeSlug(base));
      } catch (error) {
        if (!(error instanceof SlugTakenError)) throw error;
      }
    }
    throw slugTaken();
  }

  /** Restaurants the user belongs to, with their roles in each. */
  async listForUser(userId: string): Promise<RestaurantView[]> {
    const memberships = await this.memberships.listByUser(userId);
    const restaurants = await this.restaurants.findByIds(memberships.map((m) => m.restaurantId));
    const byId = new Map(restaurants.map((r) => [r.id, r]));
    return memberships.flatMap((m) => {
      const restaurant = byId.get(m.restaurantId);
      return restaurant ? [toRestaurantView(restaurant, m.roles, this.media)] : [];
    });
  }

  async get(tenant: TenantContext): Promise<RestaurantView> {
    return toRestaurantView(await this.load(tenant.restaurantId), tenant.roles, this.media);
  }

  /**
   * Updates the profile. A slug change breaks links already shared, so the UI must warn first.
   * @throws BadRequestException INVALID_SLUG, ConflictException SLUG_TAKEN.
   */
  async update(tenant: TenantContext, changes: RestaurantChanges): Promise<RestaurantView> {
    const update: RestaurantChanges = {};
    if (changes.name !== undefined) update.name = changes.name;
    if (changes.description !== undefined) update.description = changes.description;
    if (changes.phone !== undefined) update.phone = changes.phone;
    if (changes.pickupEnabled !== undefined) update.pickupEnabled = changes.pickupEnabled;
    if (changes.deliveryEnabled !== undefined) update.deliveryEnabled = changes.deliveryEnabled;
    if (changes.slug !== undefined) update.slug = normalizeRequestedSlug(changes.slug);

    try {
      const updated = await this.restaurants.update(tenant.restaurantId, update);
      if (!updated) throw notFound();
      return toRestaurantView(updated, tenant.roles, this.media);
    } catch (error) {
      if (error instanceof SlugTakenError) throw slugTaken(await this.nextFreeSlug(error.slug));
      throw error;
    }
  }

  /**
   * Sets (or with null clears) the weekly opening hours.
   * @throws BadRequestException INVALID_OPENING_HOURS.
   */
  async setOpeningHours(tenant: TenantContext, openingHours: WeeklyHours | null): Promise<RestaurantView> {
    if (openingHours !== null) {
      const problem = openingHoursProblem(openingHours, OPENING_HOURS_LIMITS.rangesPerDay);
      if (problem) throw new BadRequestException(apiError("INVALID_OPENING_HOURS", OPENING_HOURS_MESSAGES[problem]));
    }
    const updated = await this.restaurants.update(tenant.restaurantId, {
      openingHours: openingHours?.map((day) => day.map(({ open, close }) => ({ open, close }))) ?? null,
    });
    if (!updated) throw notFound();
    return toRestaurantView(updated, tenant.roles, this.media);
  }

  /**
   * Replaces the logo with a processed upload and deletes the previous files.
   * @throws UnprocessableEntityException INVALID_IMAGE.
   */
  async setLogo(tenant: TenantContext, file: Buffer): Promise<RestaurantView> {
    const key = await this.media.storeImage("logo", `restaurants/${tenant.restaurantId}/logo`, file);
    const previous = await this.restaurants.setLogoKey(tenant.restaurantId, key);
    if (previous === undefined) {
      await this.media.deleteImage("logo", key);
      throw notFound();
    }
    await this.media.deleteImage("logo", previous);
    return this.get(tenant);
  }

  async removeLogo(tenant: TenantContext): Promise<RestaurantView> {
    const previous = await this.restaurants.setLogoKey(tenant.restaurantId, null);
    await this.media.deleteImage("logo", previous ?? null);
    return this.get(tenant);
  }

  /** Opens or closes the restaurant for orders and tells every connected staff screen. */
  async setAcceptingOrders(tenant: TenantContext, acceptingOrders: boolean): Promise<RestaurantView> {
    const updated = await this.restaurants.setAcceptingOrders(tenant.restaurantId, acceptingOrders);
    if (!updated) throw notFound();
    this.realtime
      .toRestaurant(tenant.restaurantId)
      .emit("restaurant.accepting", { restaurantId: tenant.restaurantId, acceptingOrders });
    return toRestaurantView(updated, tenant.roles, this.media);
  }

  /** Live check for the slug field of the create/edit forms. */
  async checkSlug(requested: string): Promise<SlugAvailability> {
    const slug = requested.trim().toLowerCase();
    const problem = slugProblem(slug);
    if (problem) return { slug, available: false, reason: problem };
    if (!(await this.restaurants.slugExists(slug))) return { slug, available: true };
    return { slug, available: false, reason: "taken", suggestion: await this.nextFreeSlug(slug) };
  }

  private async createWithOwner(ownerId: string, name: string, slug: string): Promise<RestaurantView> {
    return this.connection.transaction(async (session) => {
      const restaurant = await this.restaurants.create({ name, slug, createdBy: ownerId }, session);
      await this.memberships.create(restaurant.id, ownerId, ["owner"], session);
      return toRestaurantView(restaurant, ["owner"], this.media);
    });
  }

  /** `base` if free, otherwise the lowest free `base-<n>` (n ≥ 2). */
  private async nextFreeSlug(base: string): Promise<string> {
    const taken = new Set(await this.restaurants.findSlugFamily(base));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = withSuffix(base, n);
      if (!taken.has(candidate)) return candidate;
    }
  }

  private async load(id: string): Promise<RestaurantRecord> {
    const restaurant = await this.restaurants.findById(id);
    if (!restaurant) throw notFound();
    return restaurant;
  }
}

const notFound = () => new NotFoundException(apiError("RESTAURANT_NOT_FOUND", "Restaurante no encontrado"));

/**
 * Slug derived from a restaurant name. Names that yield an unusable slug ("Yo", "Admin", "🍕") get a
 * "restaurante-" prefix instead of failing: the owner can still edit it afterwards.
 */
export function baseSlugFor(name: string): string {
  const direct = slugify(name);
  if (!slugProblem(direct)) return direct;
  const prefixed = slugify(`restaurante ${name}`);
  return slugProblem(prefixed) ? "restaurante" : prefixed;
}
