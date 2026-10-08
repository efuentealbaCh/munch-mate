import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { generateToken, hashToken } from "../../common/crypto/tokens";
import { apiError } from "../../common/errors/api-error";
import type { ApiEnv } from "../../config/env.validation";
import { EmailQueue } from "../../infra/queue/email.queue";
import { EmailTakenError, type UserRecord, UsersRepository } from "../users/users.repository";
import { AccessTokenService } from "./access-token.service";
import { ONE_TIME_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS, ROTATION_GRACE_MS } from "./auth.constants";
import type { ClientContext } from "./auth.types";
import { OneTimeTokensRepository } from "./one-time-tokens.repository";
import { PasswordHasher } from "./password.hasher";
import { SessionsRepository } from "./sessions.repository";

/** Result of login, registration or refresh: the user plus the raw tokens to put in cookies. */
export interface IssuedSession {
  user: UserRecord;
  accessToken: string;
  refreshToken: string;
}

export const invalidSession = () =>
  new UnauthorizedException(apiError("INVALID_SESSION", "Tu sesión expiró, vuelve a ingresar"));
const invalidLink = () =>
  new BadRequestException(apiError("INVALID_TOKEN", "El enlace no es válido o ya expiró"));

@Injectable()
export class AuthService {
  private readonly appUrl: string;

  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly oneTimeTokens: OneTimeTokensRepository,
    private readonly passwords: PasswordHasher,
    private readonly accessTokens: AccessTokenService,
    private readonly emails: EmailQueue,
    config: ConfigService<ApiEnv, true>,
    @InjectPinoLogger(AuthService.name) private readonly logger: PinoLogger,
  ) {
    this.appUrl = config.get("APP_URL", { infer: true });
  }

  /**
   * Creates the account, logs it in and emails a verification link. The account can be used right away;
   * actions that require a verified email (creating a restaurant) check it later.
   * @throws ConflictException EMAIL_TAKEN.
   */
  async register(
    input: { email: string; password: string; name: string },
    client: ClientContext,
  ): Promise<IssuedSession> {
    let user: UserRecord;
    try {
      user = await this.users.create({
        email: input.email,
        name: input.name,
        passwordHash: await this.passwords.hash(input.password),
      });
    } catch (error) {
      if (error instanceof EmailTakenError) {
        throw new ConflictException(apiError("EMAIL_TAKEN", "Ese correo ya está registrado"));
      }
      throw error;
    }

    await this.sendVerificationEmail(user);
    return this.issueSession(user, client, randomUUID());
  }

  /**
   * @throws UnauthorizedException INVALID_CREDENTIALS — same error and similar timing whether the
   *   email exists or not, so the endpoint cannot be used to discover accounts.
   */
  async login(input: { email: string; password: string }, client: ClientContext): Promise<IssuedSession> {
    const user = await this.users.findByEmail(input.email);
    const valid = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);

    if (!user || !valid) {
      throw new UnauthorizedException(apiError("INVALID_CREDENTIALS", "Correo o contraseña incorrectos"));
    }
    return this.issueSession(user, client, randomUUID());
  }

  /**
   * Rotates the refresh token: the presented one becomes unusable and a new pair is issued.
   * Presenting an already-rotated token outside the grace window revokes the whole family (likely theft).
   * @throws UnauthorizedException INVALID_SESSION.
   */
  async refresh(refreshToken: string, client: ClientContext): Promise<IssuedSession> {
    const session = await this.sessions.findByTokenHash(hashToken(refreshToken));
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw invalidSession();
    }

    if (session.rotatedAt) {
      if (Date.now() - session.rotatedAt.getTime() > ROTATION_GRACE_MS) {
        await this.sessions.revokeFamily(session.familyId);
        this.logger.warn({ userId: session.userId, familyId: session.familyId }, "refresh token reuse detected");
      }
      throw invalidSession();
    }

    // Another request may rotate the same token in between; only one of them wins.
    if (!(await this.sessions.markRotated(session.id))) throw invalidSession();

    const user = await this.users.findById(session.userId);
    if (!user) {
      await this.sessions.revokeFamily(session.familyId);
      throw invalidSession();
    }
    return this.issueSession(user, client, session.familyId);
  }

  /** Revokes the session family of the given refresh token. Unknown tokens are ignored. */
  async logout(refreshToken: string): Promise<void> {
    const session = await this.sessions.findByTokenHash(hashToken(refreshToken));
    if (session) await this.sessions.revokeFamily(session.familyId);
  }

  /** @throws BadRequestException INVALID_TOKEN. */
  async verifyEmail(token: string): Promise<void> {
    const userId = await this.oneTimeTokens.consume("verify_email", hashToken(token));
    if (!userId) throw invalidLink();
    await this.users.markEmailVerified(userId);
  }

  /** Emails a new verification link, invalidating previous ones. No-op if already verified. */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.emailVerifiedAt) return;
    await this.sendVerificationEmail(user);
  }

  /** Always succeeds from the caller's point of view, so it cannot reveal whether the email exists. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return;

    await this.oneTimeTokens.invalidatePending("password_reset", user.id);
    const { token, tokenId } = await this.createOneTimeToken("password_reset", user.id);
    await this.emails.send(
      {
        template: "password-reset",
        data: { to: user.email, name: user.name, url: `${this.appUrl}/restablecer-contrasena?token=${token}` },
      },
      `password-reset-${tokenId}`,
    );
  }

  /**
   * Sets a new password and logs the user out everywhere. Also verifies the email:
   * receiving the reset link proves ownership of the address.
   * @throws BadRequestException INVALID_TOKEN.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.oneTimeTokens.consume("password_reset", hashToken(token));
    if (!userId) throw invalidLink();

    await this.users.updatePasswordHash(userId, await this.passwords.hash(newPassword));
    await this.users.markEmailVerified(userId);
    await this.sessions.revokeAllForUser(userId);
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    return this.users.findById(userId);
  }

  private async issueSession(user: UserRecord, client: ClientContext, familyId: string): Promise<IssuedSession> {
    const refreshToken = generateToken();
    const session = await this.sessions.create({
      userId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      userAgent: client.userAgent,
      ip: client.ip,
    });
    const accessToken = await this.accessTokens.sign({
      id: user.id,
      sessionId: session.id,
      emailVerified: user.emailVerifiedAt !== null,
    });
    return { user, accessToken, refreshToken };
  }

  private async sendVerificationEmail(user: UserRecord): Promise<void> {
    await this.oneTimeTokens.invalidatePending("verify_email", user.id);
    const { token, tokenId } = await this.createOneTimeToken("verify_email", user.id);
    await this.emails.send(
      {
        template: "verify-email",
        data: { to: user.email, name: user.name, url: `${this.appUrl}/verificar-email?token=${token}` },
      },
      `verify-email-${tokenId}`,
    );
  }

  private async createOneTimeToken(
    type: "verify_email" | "password_reset",
    userId: string,
  ): Promise<{ token: string; tokenId: string }> {
    const token = generateToken();
    const tokenId = await this.oneTimeTokens.create({
      type,
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ONE_TIME_TOKEN_TTL_MS),
    });
    return { token, tokenId };
  }
}
