import { ApiError } from "./api";

export const GENERIC_ERROR_MESSAGE = "Ocurrió un error inesperado. Intenta de nuevo.";
export const RATE_LIMITED_MESSAGE = "Demasiados intentos. Espera un minuto y vuelve a intentarlo.";

/**
 * User-facing Spanish message for any error thrown by an api call.
 * The api's own `message` is already written for users, so it is shown as-is except for codes that
 * deserve friendlier wording or must not leak (ORIGIN_NOT_ALLOWED should never happen in the browser).
 * @param error Anything caught from an api call.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_ERROR_MESSAGE;
  switch (error.code) {
    case "RATE_LIMITED":
      return RATE_LIMITED_MESSAGE;
    case "ORIGIN_NOT_ALLOWED":
    case "INTERNAL_ERROR":
      return GENERIC_ERROR_MESSAGE;
    default:
      return error.message || GENERIC_ERROR_MESSAGE;
  }
}

/** @returns True when the error is an {@link ApiError} with one of the given codes. */
export function hasCode(error: unknown, ...codes: string[]): error is ApiError {
  return error instanceof ApiError && codes.includes(error.code);
}
