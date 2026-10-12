import type { AdminMenuView, MenuCategoryView } from "@app/types";
import { isNameTaken } from "@app/utils";
import { Injectable } from "@nestjs/common";
import { type CategoryRecord, CategoriesRepository } from "./categories.repository";
import { categoryNameTaken, categoryNotEmpty, categoryNotFound, invalidOrder, isPermutation } from "./menu.errors";
import { ModifierGroupsService } from "./modifier-groups.service";
import { ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";

/** Admin view of the whole menu, and category management. */
@Injectable()
export class MenuService {
  constructor(
    private readonly categories: CategoriesRepository,
    private readonly productsRepository: ProductsRepository,
    private readonly products: ProductsService,
    private readonly modifierGroups: ModifierGroupsService,
  ) {}

  /** Everything the editor needs in one request: categories, products (in display order) and modifier groups. */
  async getAdminMenu(restaurantId: string): Promise<AdminMenuView> {
    const [categories, products, modifierGroups] = await Promise.all([
      this.categories.list(restaurantId),
      this.productsRepository.list(restaurantId),
      this.modifierGroups.list(restaurantId),
    ]);
    const categoryOrder = new Map(categories.map((c, index) => [c.id, index]));
    const sorted = [...products].sort(
      (a, b) =>
        (categoryOrder.get(a.categoryId) ?? Number.MAX_SAFE_INTEGER) -
          (categoryOrder.get(b.categoryId) ?? Number.MAX_SAFE_INTEGER) || a.position - b.position,
    );
    return {
      categories: categories.map(toCategoryView),
      products: sorted.map((p) => this.products.toView(p)),
      modifierGroups,
    };
  }

  /** @throws ConflictException CATEGORY_NAME_TAKEN (same name ignoring case, accents and spaces). */
  async createCategory(restaurantId: string, input: { name: string; description?: string }): Promise<MenuCategoryView> {
    if (isNameTaken(input.name, await this.categories.list(restaurantId))) throw categoryNameTaken(input.name);
    return toCategoryView(
      await this.categories.create(restaurantId, { name: input.name, description: input.description ?? "" }),
    );
  }

  /** @throws NotFoundException CATEGORY_NOT_FOUND; ConflictException CATEGORY_NAME_TAKEN. */
  async updateCategory(
    restaurantId: string,
    categoryId: string,
    changes: { name?: string; description?: string; active?: boolean },
  ): Promise<MenuCategoryView> {
    if (changes.name !== undefined && isNameTaken(changes.name, await this.categories.list(restaurantId), categoryId)) {
      throw categoryNameTaken(changes.name);
    }
    const updated = await this.categories.update(restaurantId, categoryId, changes);
    if (!updated) throw categoryNotFound();
    return toCategoryView(updated);
  }

  /**
   * Only empty categories can be deleted, so a click never silently removes products.
   * @throws NotFoundException CATEGORY_NOT_FOUND, ConflictException CATEGORY_NOT_EMPTY.
   */
  async deleteCategory(restaurantId: string, categoryId: string): Promise<void> {
    if (!(await this.categories.exists(restaurantId, categoryId))) throw categoryNotFound();
    if ((await this.productsRepository.countInCategory(restaurantId, categoryId)) > 0) throw categoryNotEmpty();
    await this.categories.delete(restaurantId, categoryId);
  }

  /** @throws BadRequestException INVALID_ORDER unless `orderedIds` lists every category exactly once. */
  async reorderCategories(restaurantId: string, orderedIds: string[]): Promise<MenuCategoryView[]> {
    const current = await this.categories.list(restaurantId);
    if (!isPermutation(orderedIds, current.map((c) => c.id))) throw invalidOrder();
    await this.categories.reorder(restaurantId, orderedIds);
    return (await this.categories.list(restaurantId)).map(toCategoryView);
  }
}

function toCategoryView(category: CategoryRecord): MenuCategoryView {
  return { id: category.id, name: category.name, description: category.description, active: category.active };
}
