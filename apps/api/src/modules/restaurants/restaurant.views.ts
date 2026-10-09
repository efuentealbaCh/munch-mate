import type { OpenState, RestaurantRole, RestaurantView } from "@app/types";
import { BadRequestException } from "@nestjs/common";
import { isOpenAt, nextOpeningAt, type OpeningHoursProblem, type SlugProblem, slugProblem } from "@app/utils";
import { apiError } from "../../common/errors/api-error";
import type { MediaService } from "../../infra/storage/media.service";
import type { RestaurantRecord } from "./restaurants.repository";

/** Whether the opening hours allow ordering at `at` (the manual switch is checked separately). */
export function openState(restaurant: RestaurantRecord, at = new Date()): OpenState {
  const openNow = isOpenAt(restaurant.openingHours, at, restaurant.timezone);
  const next = openNow ? null : nextOpeningAt(restaurant.openingHours, at, restaurant.timezone);
  return { openNow, nextOpeningAt: next?.toISOString() ?? null };
}

export const OPENING_HOURS_MESSAGES: Record<OpeningHoursProblem, string> = {
  days: "El horario debe tener los 7 días de la semana",
  ranges_per_day: "Cada día puede tener como máximo 2 tramos",
  time_format: "Usa horas en formato HH:MM (00:00 a 23:59)",
  empty_range: "Un tramo no puede abrir y cerrar a la misma hora",
  overlap: "Los tramos de un mismo día no pueden superponerse",
};

export function toRestaurantView(
  restaurant: RestaurantRecord,
  myRoles: RestaurantRole[],
  media: MediaService,
): RestaurantView {
  return {
    id: restaurant.id,
    name: restaurant.name,
    slug: restaurant.slug,
    description: restaurant.description,
    phone: restaurant.phone,
    logo: media.logoImage(restaurant.logoKey),
    acceptingOrders: restaurant.acceptingOrders,
    pickupEnabled: restaurant.pickupEnabled,
    deliveryEnabled: restaurant.deliveryEnabled,
    openingHours: restaurant.openingHours,
    openState: openState(restaurant),
    maxItemsPerOrder: restaurant.maxItemsPerOrder,
    location: restaurant.location,
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
