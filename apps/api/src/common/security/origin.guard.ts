import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { ApiEnv } from "../../config/env.validation";
import { apiError } from "../errors/api-error";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defense in depth on top of SameSite cookies: a state-changing request that carries an Origin
 * header must come from APP_URL. Browsers always send Origin on POST/PUT/PATCH/DELETE, so a forged
 * cross-site request is rejected; requests without Origin (curl, server-to-server) carry no browser cookies.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.allowedOrigin = new URL(config.get("APP_URL", { infer: true })).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.headers.origin;
    if (origin === undefined || origin === this.allowedOrigin) return true;

    throw new ForbiddenException(apiError("ORIGIN_NOT_ALLOWED", "Origen de la solicitud no permitido"));
  }
}
