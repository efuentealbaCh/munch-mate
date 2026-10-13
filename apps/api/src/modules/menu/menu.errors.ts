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
export const categoryNameTaken = (name: string) =>
  new ConflictException(apiError("CATEGORY_NAME_TAKEN", `Ya tienes una categoría llamada «${name}»`));
export const productNameTaken = (name: string) =>
  new ConflictException(apiError("PRODUCT_NAME_TAKEN", `Ya hay un producto llamado «${name}» en esta categoría`));
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

const PROMO_MESSAGES = {
  kind: "Elige si es un porcentaje o un precio especial",
  percent_range: "El descuento debe ser un porcentaje entero entre 1 y 90",
  price_not_lower: "El precio especial debe ser menor que el precio normal",
  days: "Revisa los días de la semana del descuento",
  dates: "Revisa las fechas del descuento",
  date_order: "La fecha de término debe ser posterior a la de inicio",
  label: "El texto del descuento es demasiado largo",
} as const;

export const invalidPromo = (problem: keyof typeof PROMO_MESSAGES) =>
  new BadRequestException(apiError("INVALID_PROMO", PROMO_MESSAGES[problem], { problem }));

/** Lowering the price below a special price would turn the discount into a surcharge. */
export const promoPriceNotLower = () =>
  new ConflictException(
    apiError(
      "PROMO_PRICE_NOT_LOWER",
      "El producto tiene un precio especial igual o mayor al nuevo precio: cambia o quita el descuento primero",
    ),
  );
