import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CookieOptions, Response } from "express";
import type { ApiEnv } from "../../config/env.validation";
import {
  ACCESS_COOKIE,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_MS,
} from "./auth.constants";

/** Writes and clears the session cookies. Tokens never appear in response bodies. */
@Injectable()
export class SessionCookies {
  private readonly access: CookieOptions;
  private readonly refresh: CookieOptions;

  constructor(config: ConfigService<ApiEnv, true>) {
    // Secure follows APP_URL: https in production and in the local prod stack, plain http only in `pnpm dev`.
    const secure = config.get("APP_URL", { infer: true }).startsWith("https://");
    this.access = { httpOnly: true, secure, sameSite: "lax", path: "/" };
    this.refresh = { httpOnly: true, secure, sameSite: "strict", path: REFRESH_COOKIE_PATH };
  }

  set(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...this.access, maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000 });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...this.refresh, maxAge: REFRESH_TOKEN_TTL_MS });
  }

  clear(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.access);
    res.clearCookie(REFRESH_COOKIE, this.refresh);
  }
}
