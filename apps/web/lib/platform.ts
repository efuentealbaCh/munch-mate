/** Restaurants per page in GET /api/platform/restaurants (fixed by the api). */
export const PLATFORM_PAGE_SIZE = 25;

/** Number of pages for a total (at least 1, so "Página 1 de 1" makes sense for an empty list). */
export function pageCount(total: number, pageSize = PLATFORM_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
