import type { PairPrintAgentInput, PairPrintAgentResult } from "@app/types";

/** Pairing errors the wizard reacts to (ask the code again, or stop). */
export class PairError extends Error {
  constructor(
    message: string,
    /** The api's error `code` (INVALID_PAIRING_CODE, TOO_MANY_PRINT_AGENTS, …) or NETWORK. */
    readonly code: string,
  ) {
    super(message);
  }
}

export const PAIR_TIMEOUT_MS = 15_000;

/**
 * Redeems a pairing code: `POST <server>/api/print-agents/pair`. No Origin header is sent (native client), so
 * the api's CSRF check lets it through. The returned token is a credential: callers store it, never log it.
 * @throws PairError with a message in Spanish.
 */
export async function pairAgent(
  serverUrl: string,
  input: PairPrintAgentInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PairPrintAgentResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${serverUrl}/api/print-agents/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(PAIR_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message ?? (error as Error).message;
    throw new PairError(`No se pudo conectar con ${serverUrl} (${detail}). Revisa la dirección y la conexión a internet.`, "NETWORK");
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (a proxy error page): handled below by status.
  }
  if (response.ok) {
    const result = body as Partial<PairPrintAgentResult> | null;
    if (typeof result?.agentId === "string" && typeof result.token === "string" && result.token && typeof result.restaurantName === "string") {
      return { agentId: result.agentId, token: result.token, restaurantName: result.restaurantName };
    }
    throw new PairError(`La respuesta de ${serverUrl} no es la de Munch Mate: revisa la dirección del servidor.`, "BAD_RESPONSE");
  }
  const error = (body ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof error.code === "string" ? error.code : `HTTP_${response.status}`;
  if (response.status === 429) throw new PairError("Demasiados intentos. Espera un minuto y vuelve a intentar.", code);
  if (response.status === 404) throw new PairError(`${serverUrl} no respondió como un servidor de Munch Mate (404): revisa la dirección.`, code);
  const message = typeof error.message === "string" && error.message ? error.message : `El servidor respondió ${response.status}.`;
  throw new PairError(message, code);
}
