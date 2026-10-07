import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { RestaurantsModule } from "../restaurants/restaurants.module";
import { CategoriesRepository } from "./categories.repository";
import { MenuController } from "./menu.controller";
import { MenuService } from "./menu.service";
import { ModifierGroupsRepository } from "./modifier-groups.repository";
import { ModifierGroupsService } from "./modifier-groups.service";
import { ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";
import { PublicMenuController } from "./public-menu.controller";
import { PublicMenuService } from "./public-menu.service";
import { MenuCategory, MenuCategorySchema } from "./schemas/menu-category.schema";
import { ModifierGroup, ModifierGroupSchema } from "./schemas/modifier-group.schema";
import { Product, ProductSchema } from "./schemas/product.schema";

/** Menu: categories, products, reusable modifier groups, photos and the public menu. */
@Module({
  imports: [
    RestaurantsModule,
    MongooseModule.forFeature([
      { name: MenuCategory.name, schema: MenuCategorySchema },
      { name: Product.name, schema: ProductSchema },
      { name: ModifierGroup.name, schema: ModifierGroupSchema },
    ]),
  ],
  controllers: [MenuController, PublicMenuController],
  providers: [
    MenuService,
    ProductsService,
    ModifierGroupsService,
    PublicMenuService,
    CategoriesRepository,
    ProductsRepository,
    ModifierGroupsRepository,
  ],
})
export class MenuModule {}
