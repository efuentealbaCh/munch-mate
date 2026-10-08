import type { PublicMenu, PublicModifierGroup } from "@app/types";
import { Injectable, NotFoundException } from "@nestjs/common";
import { apiError } from "../../common/errors/api-error";
import { MediaService } from "../../infra/storage/media.service";
import { openState } from "../restaurants/restaurant.views";
import { RestaurantsRepository } from "../restaurants/restaurants.repository";
import { CategoriesRepository } from "./categories.repository";
import { ModifierGroupsRepository } from "./modifier-groups.repository";
import { ProductsRepository } from "./products.repository";

const menuNotFound = () => new NotFoundException(apiError("MENU_NOT_FOUND", "No encontramos ese restaurante"));

/** Read-only menu for customers. Exposes nothing internal (ids of staff, hidden items, inactive categories). */
@Injectable()
export class PublicMenuService {
  constructor(
    private readonly restaurants: RestaurantsRepository,
    private readonly categories: CategoriesRepository,
    private readonly products: ProductsRepository,
    private readonly modifierGroups: ModifierGroupsRepository,
    private readonly media: MediaService,
  ) {}

  /**
   * Suspended restaurants answer 404 like unknown ones. Empty categories are omitted.
   * @throws NotFoundException MENU_NOT_FOUND.
   */
  async getBySlug(slug: string): Promise<PublicMenu> {
    const restaurant = await this.restaurants.findBySlug(slug.trim().toLowerCase());
    if (!restaurant || restaurant.status !== "active") throw menuNotFound();

    const [categories, products, groups] = await Promise.all([
      this.categories.list(restaurant.id, { activeOnly: true }),
      this.products.list(restaurant.id, { visibleOnly: true }),
      this.modifierGroups.list(restaurant.id),
    ]);
    const groupsById = new Map<string, PublicModifierGroup>(
      groups.map((g) => [g.id, { id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options }]),
    );

    return {
      restaurant: {
        name: restaurant.name,
        slug: restaurant.slug,
        description: restaurant.description,
        phone: restaurant.phone,
        currency: restaurant.currency,
        logo: this.media.logoImage(restaurant.logoKey),
        acceptingOrders: restaurant.acceptingOrders,
        pickupEnabled: restaurant.pickupEnabled,
        deliveryEnabled: restaurant.deliveryEnabled,
        openingHours: restaurant.openingHours,
        openState: openState(restaurant),
      },
      categories: categories
        .map((category) => ({
          id: category.id,
          name: category.name,
          description: category.description,
          products: products
            .filter((product) => product.categoryId === category.id)
            .map((product) => ({
              id: product.id,
              name: product.name,
              description: product.description,
              price: product.price,
              available: product.available,
              image: this.media.productImage(product.imageKey),
              modifierGroups: product.modifierGroupIds.flatMap((id) => {
                const group = groupsById.get(id);
                return group ? [group] : [];
              }),
            })),
        }))
        .filter((category) => category.products.length > 0),
    };
  }
}
