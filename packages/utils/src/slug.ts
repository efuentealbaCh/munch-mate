/** Length bounds of a restaurant slug (the `{slug}` in `/r/{slug}`). */
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 50;

/**
 * Slugs that may not be used by restaurants: app routes, infrastructure hostnames and the brand itself.
 * Kept generous so future subdomains (`{slug}.munchmate.cl`) or top-level routes do not collide.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "ayuda",
  "blog",
  "cuenta",
  "dashboard",
  "healthz",
  "ingresar",
  "invitacion",
  "login",
  "mail",
  "munch-mate",
  "munchmate",
  "nuevo",
  "r",
  "registro",
  "restablecer-contrasena",
  "s3",
  "soporte",
  "static",
  "status",
  "t",
  "verificar-email",
  "www",
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SlugProblem = "too_short" | "too_long" | "invalid_characters" | "reserved";

/**
 * Turns free text (a restaurant name) into a slug: lowercase ASCII letters, digits and single hyphens.
 * Accents are removed ("Picá" → "pica", "Ñuñoa" → "nunoa"). May return a string shorter than
 * SLUG_MIN_LENGTH, or even empty; callers decide the fallback.
 * @example slugify("La Picá de Juan!") === "la-pica-de-juan"
 */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining accents, including the tilde of ñ
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
}

/** @returns Why the slug is not acceptable, or null if it is valid. Does not check uniqueness. */
export function slugProblem(slug: string): SlugProblem | null {
  if (slug.length < SLUG_MIN_LENGTH) return "too_short";
  if (slug.length > SLUG_MAX_LENGTH) return "too_long";
  if (!SLUG_PATTERN.test(slug)) return "invalid_characters";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}

/**
 * Appends a numeric suffix while keeping the result within SLUG_MAX_LENGTH.
 * @example withSuffix("la-pica", 2) === "la-pica-2"
 */
export function withSuffix(slug: string, n: number): string {
  const suffix = `-${n}`;
  return `${slug.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;
}
