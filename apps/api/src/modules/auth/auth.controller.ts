import type { UserProfile } from "@app/types";
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import type { UserRecord } from "../users/users.repository";
import { REFRESH_COOKIE } from "./auth.constants";
import { AuthService, invalidSession } from "./auth.service";
import type { AuthUser, ClientContext } from "./auth.types";
import { CurrentUser, Public } from "./decorators";
import { EmailDto, LoginDto, RegisterDto, ResetPasswordDto, TokenDto } from "./dto/auth.dto";
import { SessionCookies } from "./session-cookies";

/** Stricter limits than the global default (300/min): these endpoints are brute-force and spam targets. */
const PER_MINUTE = (limit: number) => ({ default: { limit, ttl: 60_000 } });

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: SessionCookies,
  ) {}

  @Public()
  @Throttle(PER_MINUTE(5))
  @Post("register")
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserProfile> {
    const session = await this.auth.register(dto, clientContext(req));
    this.cookies.set(res, session);
    return toProfile(session.user);
  }

  @Public()
  @Throttle(PER_MINUTE(10))
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserProfile> {
    const session = await this.auth.login(dto, clientContext(req));
    this.cookies.set(res, session);
    return toProfile(session.user);
  }

  /** Public because the access token is usually already expired when this is called. */
  @Public()
  @Throttle(PER_MINUTE(30))
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<UserProfile> {
    const refreshToken = readRefreshCookie(req);
    try {
      if (!refreshToken) throw invalidSession();
      const session = await this.auth.refresh(refreshToken, clientContext(req));
      this.cookies.set(res, session);
      return toProfile(session.user);
    } catch (error) {
      // Dead session: drop the cookies so the browser stops sending them.
      this.cookies.clear(res);
      throw error;
    }
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const refreshToken = readRefreshCookie(req);
    if (refreshToken) await this.auth.logout(refreshToken);
    this.cookies.clear(res);
  }

  @Get("me")
  async me(@CurrentUser() user: AuthUser): Promise<UserProfile> {
    const record = await this.auth.getUser(user.id);
    // The access token outlives a deleted account by at most 15 minutes; treat it as logged out.
    if (!record) throw invalidSession();
    return toProfile(record);
  }

  @Public()
  @Throttle(PER_MINUTE(10))
  @Post("verify-email")
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(@Body() dto: TokenDto): Promise<void> {
    await this.auth.verifyEmail(dto.token);
  }

  @Throttle(PER_MINUTE(3))
  @Post("resend-verification")
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@CurrentUser() user: AuthUser): Promise<void> {
    await this.auth.resendVerification(user.id);
  }

  @Public()
  @Throttle(PER_MINUTE(3))
  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() dto: EmailDto): Promise<void> {
    await this.auth.requestPasswordReset(dto.email);
  }

  @Public()
  @Throttle(PER_MINUTE(5))
  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
    this.cookies.clear(res);
  }
}

function readRefreshCookie(req: Request): string | null {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function clientContext(req: Request): ClientContext {
  return { ip: req.ip ?? null, userAgent: req.headers["user-agent"]?.slice(0, 200) ?? null };
}

function toProfile(user: UserRecord): UserProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    platformRole: user.platformRole,
  };
}
