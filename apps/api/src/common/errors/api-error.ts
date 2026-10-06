export type { ApiErrorBody } from "@app/types";

/**
 * Builds the payload for a Nest HttpException so the global filter keeps the given code.
 * @param meta Machine-readable extras returned as `meta` (e.g. a slug suggestion).
 * @example throw new ConflictException(apiError("EMAIL_TAKEN", "Ese correo ya está registrado"))
 */
export function apiError(
  code: string,
  message: string,
  meta?: Record<string, string>,
): { code: string; message: string; meta?: Record<string, string> } {
  return meta ? { code, message, meta } : { code, message };
}
