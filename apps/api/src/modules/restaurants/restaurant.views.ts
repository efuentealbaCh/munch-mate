import type { RestaurantRole, RestaurantView } from "@app/types";
import { BadRequestException } from "@nestjs/common";
import { type SlugProblem, slugProblem } from "@app/utils";
import { apiError } from "../../common/errors/api-error";
import type { RestaurantRecord } from "./restaurants.repository";

export function toRestaurantView(restaurant: RestaurantRecord, myRoles: RestaurantRole[]): RestaurantView {
  return {
    id: restaurant.id,
    name: restaurant.name,
    slug: restaurant.slug,
    currency: restaurant.currency,
    timezone: restaurant.timezone,
    status: restaurant.status,
    myRoles,
  };
}

const SLUG_MESSAGES: Record<SlugProblem, string> = {
  too_short: "La dirección debe tener al menos 3 caracteres",
  too_long: "La dirección no puede superar los 50 caracteres",
  invalid_characters: "Usa solo minúsculas, números y guiones simples (sin espacios ni tildes)",
  reserved: "Esa dirección está reservada, elige otra",
};

/**
 * Normalizes a slug typed by the user (trim + lowercase) and validates it.
 * Does not slugify: what the owner sees in the form is exactly what gets stored.
 * @throws BadRequestException INVALID_SLUG.
 */
export function normalizeRequestedSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  const problem = slugProblem(normalized);
  if (problem) throw new BadRequestException(apiError("INVALID_SLUG", SLUG_MESSAGES[problem]));
  return normalized;
}
