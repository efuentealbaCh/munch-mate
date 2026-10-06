import type { SlugAvailability } from "@app/types";
import { type SlugProblem, slugify, slugProblem } from "@app/utils";

/** Same wording as the api's INVALID_SLUG messages (apps/api/src/modules/restaurants/restaurant.views.ts). */
export const SLUG_PROBLEM_MESSAGES: Record<SlugProblem, string> = {
  too_short: "La dirección debe tener al menos 3 caracteres",
  too_long: "La dirección no puede superar los 50 caracteres",
  invalid_characters: "Usa solo minúsculas, números y guiones simples (sin espacios ni tildes)",
  reserved: "Esa dirección está reservada, elige otra",
};

/** What the slug field shows next to the input. */
export type SlugStatus =
  | { kind: "idle" }
  | { kind: "unchanged" }
  | { kind: "invalid"; problem: SlugProblem }
  | { kind: "checking" }
  | { kind: "available" }
  | { kind: "taken"; suggestion?: string }
  | { kind: "error"; message: string };

/**
 * Normalizes what the user types in the slug input. Only lowercases (as the api does); it does not
 * slugify, so the owner sees exactly what will be stored and gets a clear message for invalid characters.
 */
export function normalizeSlugInput(raw: string): string {
  return raw.toLowerCase();
}

/**
 * Value of the slug field after the name changes: follows `slugify(name)` until the user edits the slug
 * by hand, then it is left alone.
 * @param name Current restaurant name.
 * @param slugTouched Whether the user has edited the slug manually.
 * @param currentSlug Current value of the slug field.
 */
export function slugAfterNameChange(name: string, slugTouched: boolean, currentSlug: string): string {
  return slugTouched ? currentSlug : slugify(name);
}

/**
 * Status that can be decided without the api.
 * @param slug Normalized slug.
 * @param originalSlug The restaurant's current slug when editing (unchanged slugs need no check).
 * @returns The local status, or null when the availability must be asked to the api.
 */
export function localSlugStatus(slug: string, originalSlug?: string): SlugStatus | null {
  const trimmed = slug.trim();
  if (originalSlug !== undefined && trimmed === originalSlug) return { kind: "unchanged" };
  if (trimmed === "") return { kind: "idle" };
  const problem = slugProblem(trimmed);
  return problem ? { kind: "invalid", problem } : null;
}

/** Maps the api's availability answer to a field status. */
export function statusFromAvailability(availability: SlugAvailability): SlugStatus {
  if (availability.available) return { kind: "available" };
  if (availability.reason === "taken" || availability.reason === undefined) {
    return availability.suggestion ? { kind: "taken", suggestion: availability.suggestion } : { kind: "taken" };
  }
  return { kind: "invalid", problem: availability.reason };
}

/** @returns Whether the form may be submitted with this slug status (the api still has the last word). */
export function slugStatusAllowsSubmit(status: SlugStatus): boolean {
  return status.kind !== "invalid" && status.kind !== "taken";
}
