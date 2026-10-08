import { type CanActivate, type ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import { apiError } from "../../common/errors/api-error";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { UsersRepository } from "../users/users.repository";

/**
 * Lets only platform admins (`users.platformRole = "admin"`) through. The role is read from the database on
 * every request, not from the access token, so revoking it takes effect immediately. Others get 404, like
 * any route they are not meant to know about.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly users: UsersRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userId = context.switchToHttp().getRequest<AuthenticatedRequest>().user?.id;
    const user = userId ? await this.users.findById(userId) : null;
    if (user?.platformRole !== "admin") throw new NotFoundException(apiError("NOT_FOUND", "No encontramos esa página"));
    return true;
  }
}
