export type { ApiErrorBody } from "@app/types";

/**
 * Builds the payload for a Nest HttpException so the global filter keeps the given code.
 * @example throw new ConflictException(apiError("EMAIL_TAKEN", "Ese correo ya está registrado"))
 */
export function apiError(code: string, message: string): { code: string; message: string } {
  return { code, message };
}
