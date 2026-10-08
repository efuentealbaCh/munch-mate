import type { OpenState, WeeklyHours } from "./restaurants";
/**
 * Limits shared by the api DTOs and the web forms, so both validate the same way.
 * Prices are integers in the currency's minor unit (CLP has none: 3990 = $3.990).
 */
export const MENU_LIMITS = {
  nameMax: 80,
  descriptionMax: 300,
  priceMax: 10_000_000,
  optionsPerGroupMax: 30,
  groupsPerProductMax: 10,
  imageMaxBytes: 8 * 1024 * 1024,
  /** Smallest accepted image side, in pixels. */
  imageMinSide: 200,
} as const;

/** Product photo, re-encoded as WebP (4:3) in three widths: sm 160, md 480, lg 960 px. */
export interface ProductImage {
  sm: string;
  md: string;
  lg: string;
}

/** Restaurant logo, square WebP: sm 96, md 256 px. */
export interface LogoImage {
  sm: string;
  md: string;
}

export interface MenuCategoryView {
  id: string;
  name: string;
  description: string;
  /** false = hidden from the public menu (products kept). */
  active: boolean;
}

export interface ModifierOptionView {
  id: string;
  name: string;
  /** Added to the product price when chosen (≥ 0). */
  priceDelta: number;
  available: boolean;
}

/**
 * Reusable group of options ("Tamaño", "Agregados") assigned to many products.
 * minSelect 0 = optional; minSelect ≥ 1 = required. maxSelect 1 = single choice.
 */
export interface ModifierGroupView {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOptionView[];
  /** How many products use it (shown before deleting). */
  usedByProducts: number;
}

export interface ProductView {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  /** false = "Agotado": shown but cannot be ordered. Staff (owner, cashier, kitchen) can toggle it. */
  available: boolean;
  /** false = hidden from the public menu (owner only). */
  visible: boolean;
  image: ProductImage | null;
  /** In display order. */
  modifierGroupIds: string[];
}

/** Everything the admin menu editor needs, in display order, in one request. */
export interface AdminMenuView {
  categories: MenuCategoryView[];
  products: ProductView[];
  modifierGroups: ModifierGroupView[];
}

export interface PublicModifierGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOptionView[];
}

export interface PublicProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  available: boolean;
  image: ProductImage | null;
  modifierGroups: PublicModifierGroup[];
}

/** Public menu at /r/{slug}: only active categories and visible products, nothing internal. */
export interface PublicMenu {
  restaurant: {
    name: string;
    slug: string;
    description: string;
    phone: string;
    currency: string;
    logo: LogoImage | null;
    /** The open/closed switch: while false the menu is browsable but nothing can be ordered. */
    acceptingOrders: boolean;
    /** Opening hours (null = not published) and whether they allow ordering now. */
    openingHours: WeeklyHours | null;
    openState: OpenState;
    /** Whether customers may order for pickup from this menu (owner setting). */
    pickupEnabled: boolean;
    /** Whether customers may order for delivery (owner setting; zones at `/delivery-zones`). */
    deliveryEnabled: boolean;
  };
  categories: { id: string; name: string; description: string; products: PublicProduct[] }[];
}
