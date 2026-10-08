import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { apiError } from "../../common/errors/api-error";

export const categoryNotFound = () =>
  new NotFoundException(apiError("CATEGORY_NOT_FOUND", "La categoría no existe"));
export const productNotFound = () => new NotFoundException(apiError("PRODUCT_NOT_FOUND", "El producto no existe"));
export const modifierGroupNotFound = () =>
  new NotFoundException(apiError("MODIFIER_GROUP_NOT_FOUND", "El grupo de opciones no existe"));
export const modifierOptionNotFound = () =>
  new NotFoundException(apiError("MODIFIER_OPTION_NOT_FOUND", "La opción no existe"));
export const categoryNotEmpty = () =>
  new ConflictException(
    apiError("CATEGORY_NOT_EMPTY", "La categoría tiene productos: muévelos o elimínalos antes de borrarla"),
  );
/** A referenced category does not belong to the restaurant (or does not exist). */
export const invalidCategory = () =>
  new BadRequestException(apiError("INVALID_CATEGORY", "La categoría elegida no existe en este restaurante"));
export const invalidModifierGroups = () =>
  new BadRequestException(
    apiError("INVALID_MODIFIER_GROUP", "Alguno de los grupos de opciones no existe en este restaurante"),
  );
export const invalidOrder = () =>
  new BadRequestException(
    apiError("INVALID_ORDER", "El nuevo orden debe incluir exactamente los mismos elementos, sin repetir"),
  );

/** True when `ids` is a permutation of `expected`: same elements, no duplicates, nothing missing. */
export function isPermutation(ids: string[], expected: string[]): boolean {
  if (ids.length !== expected.length || new Set(ids).size !== ids.length) return false;
  const expectedSet = new Set(expected);
  return ids.every((id) => expectedSet.has(id));
}
