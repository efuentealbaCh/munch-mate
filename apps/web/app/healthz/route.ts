/** Liveness probe for the Docker healthcheck. Not under /api because Caddy routes /api/* to the NestJS api. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok" });
}
