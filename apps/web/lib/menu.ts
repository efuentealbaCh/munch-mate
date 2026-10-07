import { MENU_LIMITS, type RestaurantRole } from "@app/types";

/** Roles that may mark products and options as sold out (the api enforces the same list). */
export const AVAILABILITY_ROLES: readonly RestaurantRole[] = ["owner", "cashier", "kitchen"];

/** @returns True when any of the roles may use the "Disponibilidad" screen. */
export function canManageAvailability(roles: readonly RestaurantRole[]): boolean {
  return roles.some((role) => AVAILABILITY_ROLES.includes(role));
}

/**
 * Groups products under their categories, keeping both orders (categories as given, products in their
 * display order). Products pointing to an unknown category are left out.
 * @returns One entry per category, including categories without products.
 */
export function groupProductsByCategory<C extends { id: string }, P extends { categoryId: string }>(
  categories: readonly C[],
  products: readonly P[],
): Array<{ category: C; products: P[] }> {
  const byCategory = new Map<string, P[]>(categories.map((category) => [category.id, []]));
  for (const product of products) byCategory.get(product.categoryId)?.push(product);
  return categories.map((category) => ({ category, products: byCategory.get(category.id) ?? [] }));
}

/**
 * Plain-language selection rule of a modifier group, as customers and owners read it:
 * "Obligatorio · elige 1", "Obligatorio · elige de 1 a 2", "Opcional · hasta 3".
 */
export function modifierRuleSummary(minSelect: number, maxSelect: number): string {
  if (minSelect <= 0) return `Opcional · hasta ${maxSelect}`;
  if (minSelect >= maxSelect) return `Obligatorio · elige ${minSelect}`;
  return `Obligatorio · elige de ${minSelect} a ${maxSelect}`;
}

/**
 * Same rules the api checks (INVALID_MODIFIER_RULES), with the same wording.
 * @returns The problem, or null when the rules can be satisfied.
 */
export function modifierRulesProblem(minSelect: number, maxSelect: number, optionCount: number): string | null {
  if (maxSelect < minSelect) return "El máximo de opciones no puede ser menor que el mínimo";
  if (maxSelect > optionCount) return `El máximo (${maxSelect}) no puede superar la cantidad de opciones (${optionCount})`;
  return null;
}

/**
 * Returns a copy of `items` with the element at `from` moved to `to`. Out-of-range moves return an
 * unchanged copy, so "move up" on the first item is a no-op.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  if (from < 0 || from >= copy.length || to < 0 || to >= copy.length || from === to) return copy;
  const [item] = copy.splice(from, 1) as [T];
  copy.splice(to, 0, item);
  return copy;
}

/** Image types the api accepts (it checks the real bytes; this only avoids pointless uploads). */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

/** Value for the `accept` attribute of file inputs. */
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

const MAX_MB = Math.round(MENU_LIMITS.imageMaxBytes / (1024 * 1024));

/**
 * Client-side check before uploading a photo or logo.
 * @param file The picked file (only `size` and `type` are read).
 * @returns A Spanish message explaining the problem, or null when it can be uploaded.
 */
export function imageFileProblem(file: { size: number; type: string }): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return "Usa una imagen JPG, PNG, WebP o AVIF.";
  }
  if (file.size > MENU_LIMITS.imageMaxBytes) return `La imagen pesa más de ${MAX_MB} MB. Elige una más liviana.`;
  if (file.size === 0) return "El archivo está vacío.";
  return null;
}

/** @returns A message when the image is smaller than the api's minimum side, or null. */
export function imageDimensionsProblem(width: number, height: number): string | null {
  const min = MENU_LIMITS.imageMinSide;
  if (width < min || height < min) {
    return `La imagen es muy pequeña (${width}×${height} px). Usa una de al menos ${min}×${min} px.`;
  }
  return null;
}
