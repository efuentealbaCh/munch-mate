import type { ProductView } from "@app/types";
import { Injectable } from "@nestjs/common";
import { MediaService } from "../../infra/storage/media.service";
import { CategoriesRepository } from "./categories.repository";
import {
  categoryNotFound,
  invalidCategory,
  invalidModifierGroups,
  invalidOrder,
  isPermutation,
  productNotFound,
} from "./menu.errors";
import { ModifierGroupsRepository } from "./modifier-groups.repository";
import { type ProductInput, type ProductRecord, ProductsRepository } from "./products.repository";

export interface CreateProductInput {
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  visible?: boolean;
  modifierGroupIds?: string[];
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly categories: CategoriesRepository,
    private readonly modifierGroups: ModifierGroupsRepository,
    private readonly media: MediaService,
  ) {}

  /** @throws BadRequestException INVALID_CATEGORY, INVALID_MODIFIER_GROUP. */
  async create(restaurantId: string, input: CreateProductInput): Promise<ProductView> {
    const modifierGroupIds = input.modifierGroupIds ?? [];
    await this.assertReferences(restaurantId, input.categoryId, modifierGroupIds);
    const created = await this.products.create(restaurantId, {
      categoryId: input.categoryId,
      name: input.name,
      description: input.description ?? "",
      price: input.price,
      visible: input.visible ?? true,
      modifierGroupIds,
    });
    return this.toView(created);
  }

  /**
   * Partial update. Moving to another category appends the product at its end.
   * @throws NotFoundException PRODUCT_NOT_FOUND; BadRequestException INVALID_CATEGORY, INVALID_MODIFIER_GROUP.
   */
  async update(restaurantId: string, productId: string, changes: Partial<ProductInput>): Promise<ProductView> {
    const current = await this.products.findOne(restaurantId, productId);
    if (!current) throw productNotFound();

    const movedCategory = changes.categoryId !== undefined && changes.categoryId !== current.categoryId;
    await this.assertReferences(
      restaurantId,
      movedCategory ? changes.categoryId : undefined,
      changes.modifierGroupIds ?? [],
    );

    const updated = await this.products.update(restaurantId, productId, changes, movedCategory);
    if (!updated) throw productNotFound();
    return this.toView(updated);
  }

  async delete(restaurantId: string, productId: string): Promise<void> {
    const deleted = await this.products.delete(restaurantId, productId);
    if (!deleted) throw productNotFound();
    await this.media.deleteImage("product", deleted.imageKey);
  }

  /** "Agotado" toggle, allowed to kitchen and cashier staff too. */
  async setAvailability(restaurantId: string, productId: string, available: boolean): Promise<void> {
    if (!(await this.products.setAvailability(restaurantId, productId, available))) throw productNotFound();
  }

  /** @throws NotFoundException CATEGORY_NOT_FOUND; BadRequestException INVALID_ORDER. */
  async reorder(restaurantId: string, categoryId: string, orderedIds: string[]): Promise<void> {
    if (!(await this.categories.exists(restaurantId, categoryId))) throw categoryNotFound();
    const current = await this.products.idsInCategory(restaurantId, categoryId);
    if (!isPermutation(orderedIds, current)) throw invalidOrder();
    await this.products.reorderInCategory(restaurantId, categoryId, orderedIds);
  }

  /**
   * Replaces the photo. The product is checked first so no image is processed for a wrong id.
   * @throws NotFoundException PRODUCT_NOT_FOUND; UnprocessableEntityException INVALID_IMAGE.
   */
  async setImage(restaurantId: string, productId: string, file: Buffer): Promise<ProductView> {
    if (!(await this.products.findOne(restaurantId, productId))) throw productNotFound();

    const key = await this.media.storeImage("product", `restaurants/${restaurantId}/products/${productId}`, file);
    const previous = await this.products.setImageKey(restaurantId, productId, key);
    if (previous === undefined) {
      // Deleted while the image was processing.
      await this.media.deleteImage("product", key);
      throw productNotFound();
    }
    await this.media.deleteImage("product", previous);
    return this.get(restaurantId, productId);
  }

  async removeImage(restaurantId: string, productId: string): Promise<ProductView> {
    const previous = await this.products.setImageKey(restaurantId, productId, null);
    if (previous === undefined) throw productNotFound();
    await this.media.deleteImage("product", previous);
    return this.get(restaurantId, productId);
  }

  toView(product: ProductRecord): ProductView {
    return {
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      description: product.description,
      price: product.price,
      available: product.available,
      visible: product.visible,
      image: this.media.productImage(product.imageKey),
      modifierGroupIds: product.modifierGroupIds,
    };
  }

  private async get(restaurantId: string, productId: string): Promise<ProductView> {
    const product = await this.products.findOne(restaurantId, productId);
    if (!product) throw productNotFound();
    return this.toView(product);
  }

  /**
   * Referenced ids must belong to this restaurant: ids from another tenant are rejected exactly
   * like nonexistent ones.
   */
  private async assertReferences(
    restaurantId: string,
    categoryId: string | undefined,
    modifierGroupIds: string[],
  ): Promise<void> {
    if (categoryId !== undefined && !(await this.categories.exists(restaurantId, categoryId))) {
      throw invalidCategory();
    }
    if (modifierGroupIds.length > 0) {
      const existing = await this.modifierGroups.existingIds(restaurantId, modifierGroupIds);
      if (modifierGroupIds.some((id) => !existing.has(id))) throw invalidModifierGroups();
    }
  }
}
