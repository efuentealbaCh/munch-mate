import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AuthenticatedRequest, AuthUser } from "./auth.types";

export const IS_PUBLIC = "auth:isPublic";

/** Opts a route out of the global access-token guard (every route requires a session by default). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The signed-in user on a public route, or undefined for anonymous visitors. */
export const OptionalUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

/** Injects the authenticated user. Only valid on routes protected by the access-token guard. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): AuthUser => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new Error("CurrentUser used on a route without authentication");
  return user;
});
