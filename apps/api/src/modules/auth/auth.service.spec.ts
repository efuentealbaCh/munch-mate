import { BadRequestException, ConflictException, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { PinoLogger } from "nestjs-pino";
import { hashToken } from "../../common/crypto/tokens";
import type { ApiEnv } from "../../config/env.validation";
import type { EmailQueue } from "../../infra/queue/email.queue";
import { EmailTakenError, type UserRecord, type UsersRepository } from "../users/users.repository";
import type { AccessTokenService } from "./access-token.service";
import { ROTATION_GRACE_MS } from "./auth.constants";
import { AuthService } from "./auth.service";
import type { OneTimeTokensRepository } from "./one-time-tokens.repository";
import type { PasswordHasher } from "./password.hasher";
import type { SessionRecord, SessionsRepository } from "./sessions.repository";

const client = { ip: "203.0.113.7", userAgent: "jest" };

const user: UserRecord = {
  id: "u1",
  email: "ana@example.com",
  name: "Ana",
  passwordHash: "hash",
  emailVerifiedAt: null,
  platformRole: null,
};

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "s1",
    userId: user.id,
    familyId: "family-1",
    expiresAt: new Date(Date.now() + 60_000),
    rotatedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function setup() {
  const users = {
    create: jest.fn().mockResolvedValue(user),
    findByEmail: jest.fn().mockResolvedValue(user),
    findById: jest.fn().mockResolvedValue(user),
    markEmailVerified: jest.fn(),
    updatePasswordHash: jest.fn(),
  };
  const sessions = {
    create: jest.fn().mockImplementation(async () => session({ id: "s-new" })),
    findByTokenHash: jest.fn().mockResolvedValue(session()),
    markRotated: jest.fn().mockResolvedValue(true),
    revokeFamily: jest.fn(),
    revokeAllForUser: jest.fn(),
  };
  const oneTimeTokens = {
    create: jest.fn().mockResolvedValue("t1"),
    consume: jest.fn().mockResolvedValue(user.id),
    invalidatePending: jest.fn(),
  };
  const passwords = {
    hash: jest.fn().mockResolvedValue("new-hash"),
    verify: jest.fn().mockResolvedValue(true),
    verifyDummy: jest.fn().mockResolvedValue(false),
  };
  const accessTokens = { sign: jest.fn().mockResolvedValue("access-jwt") };
  const emails = { send: jest.fn() };
  const config = { get: () => "https://munchmate.cl" } as unknown as ConfigService<ApiEnv, true>;
  const logger = { warn: jest.fn() } as unknown as PinoLogger;

  const service = new AuthService(
    users as unknown as UsersRepository,
    sessions as unknown as SessionsRepository,
    oneTimeTokens as unknown as OneTimeTokensRepository,
    passwords as unknown as PasswordHasher,
    accessTokens as unknown as AccessTokenService,
    emails as unknown as EmailQueue,
    config,
    logger,
  );
  return { service, users, sessions, oneTimeTokens, passwords, emails };
}

describe("AuthService", () => {
  describe("register", () => {
    it("emails a verification link pointing to APP_URL and opens a session", async () => {
      const { service, emails, sessions } = setup();

      const result = await service.register({ email: user.email, password: "pw", name: "Ana" }, client);

      expect(result.refreshToken).toEqual(expect.any(String));
      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ tokenHash: hashToken(result.refreshToken), ip: client.ip }),
      );
      expect(emails.send).toHaveBeenCalledWith(
        {
          template: "verify-email",
          data: expect.objectContaining({ url: expect.stringMatching(/^https:\/\/munchmate\.cl\/verificar-email\?token=/) }),
        },
        "verify-email-t1",
      );
    });

    it("maps a duplicate email to 409", async () => {
      const { service, users } = setup();
      users.create.mockRejectedValue(new EmailTakenError());

      await expect(service.register({ email: user.email, password: "pw", name: "Ana" }, client)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("login", () => {
    it("runs a dummy verification for unknown emails so timing does not reveal accounts", async () => {
      const { service, users, passwords } = setup();
      users.findByEmail.mockResolvedValue(null);

      await expect(service.login({ email: "x@example.com", password: "pw" }, client)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(passwords.verifyDummy).toHaveBeenCalledWith("pw");
    });
  });

  describe("refresh", () => {
    it("rotates the session within the same family", async () => {
      const { service, sessions } = setup();

      await service.refresh("raw-token", client);

      expect(sessions.findByTokenHash).toHaveBeenCalledWith(hashToken("raw-token"));
      expect(sessions.markRotated).toHaveBeenCalledWith("s1");
      expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({ familyId: "family-1" }));
    });

    it.each([
      ["unknown", null],
      ["revoked", session({ revokedAt: new Date() })],
      ["expired", session({ expiresAt: new Date(Date.now() - 1) })],
    ])("rejects an %s session", async (_, found) => {
      const { service, sessions } = setup();
      sessions.findByTokenHash.mockResolvedValue(found);

      await expect(service.refresh("raw", client)).rejects.toThrow(UnauthorizedException);
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it("treats reuse within the grace window as a concurrent refresh: rejects without revoking", async () => {
      const { service, sessions } = setup();
      sessions.findByTokenHash.mockResolvedValue(session({ rotatedAt: new Date(Date.now() - 1000) }));

      await expect(service.refresh("raw", client)).rejects.toThrow(UnauthorizedException);
      expect(sessions.revokeFamily).not.toHaveBeenCalled();
    });

    it("treats reuse after the grace window as theft: revokes the whole family", async () => {
      const { service, sessions } = setup();
      sessions.findByTokenHash.mockResolvedValue(
        session({ rotatedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1000) }),
      );

      await expect(service.refresh("raw", client)).rejects.toThrow(UnauthorizedException);
      expect(sessions.revokeFamily).toHaveBeenCalledWith("family-1");
    });

    it("rejects when a concurrent refresh rotated the session first", async () => {
      const { service, sessions } = setup();
      sessions.markRotated.mockResolvedValue(false);

      await expect(service.refresh("raw", client)).rejects.toThrow(UnauthorizedException);
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it("revokes the family when the user no longer exists", async () => {
      const { service, users, sessions } = setup();
      users.findById.mockResolvedValue(null);

      await expect(service.refresh("raw", client)).rejects.toThrow(UnauthorizedException);
      expect(sessions.revokeFamily).toHaveBeenCalledWith("family-1");
    });
  });

  describe("one-time links", () => {
    it("rejects an invalid verification token", async () => {
      const { service, oneTimeTokens } = setup();
      oneTimeTokens.consume.mockResolvedValue(null);

      await expect(service.verifyEmail("bad")).rejects.toThrow(BadRequestException);
    });

    it("does not resend verification to an already verified user", async () => {
      const { service, users, emails } = setup();
      users.findById.mockResolvedValue({ ...user, emailVerifiedAt: new Date() });

      await service.resendVerification(user.id);

      expect(emails.send).not.toHaveBeenCalled();
    });

    it("password reset revokes every session and verifies the email", async () => {
      const { service, users, sessions } = setup();

      await service.resetPassword("token", "new password");

      expect(users.updatePasswordHash).toHaveBeenCalledWith(user.id, "new-hash");
      expect(users.markEmailVerified).toHaveBeenCalledWith(user.id);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(user.id);
    });

    it("forgot-password for an unknown email sends nothing", async () => {
      const { service, users, emails } = setup();
      users.findByEmail.mockResolvedValue(null);

      await service.requestPasswordReset("nobody@example.com");

      expect(emails.send).not.toHaveBeenCalled();
    });
  });
});
