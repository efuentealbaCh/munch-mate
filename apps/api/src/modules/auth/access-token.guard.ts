import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { apiError } from "../../common/errors/api-error";
import { AccessTokenService } from "./access-token.service";
import { ACCESS_COOKIE } from "./auth.constants";
import type { AuthenticatedRequest } from "./auth.types";
import { IS_PUBLIC } from "./decorators";

/**
 * Global guard: every route needs a valid access-token cookie unless marked `@Public()`.
 * A 401 UNAUTHENTICATED tells the frontend to call POST /api/auth/refresh and retry once.
 * On public routes a valid cookie still identifies the user (`@OptionalUser()`), e.g. a signed-in customer
 * ordering from a public menu; a missing or expired one is simply ignored there.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    const user = typeof token === "string" ? await this.accessTokens.verify(token) : null;

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      if (user) req.user = user;
      return true;
    }
    if (!user) {
      throw new UnauthorizedException(apiError("UNAUTHENTICATED", "Debes iniciar sesión"));
    }

    req.user = user;
    return true;
  }
}
