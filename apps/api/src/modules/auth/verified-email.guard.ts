import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { apiError } from "../../common/errors/api-error";
import { UsersRepository } from "../users/users.repository";
import type { AuthenticatedRequest } from "./auth.types";

/**
 * Requires a verified email (e.g. to create a restaurant). Use after the global access-token guard.
 * The access token's claim can be up to 15 minutes stale right after verifying, so a negative claim
 * is confirmed against the database before rejecting.
 */
@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(private readonly users: UsersRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (user?.emailVerified) return true;

    const record = user ? await this.users.findById(user.id) : null;
    if (record?.emailVerifiedAt) return true;

    throw new ForbiddenException(
      apiError("EMAIL_NOT_VERIFIED", "Confirma tu correo antes de continuar. Revisa tu bandeja de entrada."),
    );
  }
}
