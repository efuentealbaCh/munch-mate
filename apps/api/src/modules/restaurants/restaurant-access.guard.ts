import type { RestaurantRole, RestaurantStatus } from "@app/types";
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { apiError } from "../../common/errors/api-error";
import type { AuthenticatedRequest } from "../auth/auth.types";
import { MembershipsRepository } from "./memberships.repository";
import { RestaurantsRepository } from "./restaurants.repository";

/** Resolved tenant for the current request. */
export interface TenantContext {
  restaurantId: string;
  roles: RestaurantRole[];
  status: RestaurantStatus;
}

export interface TenantRequest extends AuthenticatedRequest {
  tenant?: TenantContext;
}

const ROLES_KEY = "restaurant:roles";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Restricts a route to members holding at least one of the roles. Without it, any member passes.
 * Always used together with RestaurantAccessGuard.
 */
export const RestaurantRoles = (...roles: RestaurantRole[]) => SetMetadata(ROLES_KEY, roles);

/** Injects the tenant resolved by RestaurantAccessGuard. */
export const CurrentTenant = createParamDecorator((_: unknown, context: ExecutionContext): TenantContext => {
  const tenant = context.switchToHttp().getRequest<TenantRequest>().tenant;
  if (!tenant) throw new Error("CurrentTenant used on a route without RestaurantAccessGuard");
  return tenant;
});

const notFound = () => new NotFoundException(apiError("RESTAURANT_NOT_FOUND", "Restaurante no encontrado"));

/**
 * Resolves `:restaurantId` into a tenant the user belongs to. The tenant comes from the user's membership,
 * never from data the client sends in the body.
 * - Not a member (or the restaurant does not exist) → 404, so ids of other tenants cannot be probed.
 * - Member without the required role → 403.
 * - Suspended restaurant → read-only.
 */
@Injectable()
export class RestaurantAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipsRepository,
    private readonly restaurants: RestaurantsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const restaurantId = req.params.restaurantId;
    if (!req.user || typeof restaurantId !== "string") throw notFound();

    const membership = await this.memberships.findOne(restaurantId, req.user.id);
    if (!membership) throw notFound();
    const restaurant = await this.restaurants.findById(restaurantId);
    if (!restaurant) throw notFound();

    const required = this.reflector.getAllAndOverride<RestaurantRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.some((role) => membership.roles.includes(role))) {
      throw new ForbiddenException(apiError("FORBIDDEN_ROLE", "Tu rol no permite esta acción"));
    }

    if (restaurant.status === "suspended" && !SAFE_METHODS.has(req.method)) {
      throw new ForbiddenException(apiError("RESTAURANT_SUSPENDED", "Este restaurante está suspendido"));
    }

    req.tenant = { restaurantId, roles: membership.roles, status: restaurant.status };
    return true;
  }
}
