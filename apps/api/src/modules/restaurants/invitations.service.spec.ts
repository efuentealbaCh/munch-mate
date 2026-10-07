import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Connection } from "mongoose";
import type { MediaService } from "../../infra/storage/media.service";

import { hashToken } from "../../common/crypto/tokens";
import type { ApiEnv } from "../../config/env.validation";
import type { EmailQueue } from "../../infra/queue/email.queue";
import type { UsersRepository } from "../users/users.repository";
import type { InvitationsRepository } from "./invitations.repository";
import { InvitationsService } from "./invitations.service";
import type { MembershipsRepository } from "./memberships.repository";
import type { RestaurantsRepository } from "./restaurants.repository";

/** Views only need the logo URL builder. */
const fakeMedia = { logoImage: () => null } as unknown as MediaService;

const restaurant = { id: "r1", name: "Sanguchería", slug: "s", currency: "CLP", timezone: "America/Santiago", status: "active" as const, createdBy: "u1" };
const owner = { id: "u1", name: "Dueña", email: "duena@example.com", emailVerifiedAt: new Date() };
const cook = { id: "u2", name: "Cocinero", email: "cook@example.com", emailVerifiedAt: null };
const pending = {
  id: "i1",
  restaurantId: "r1",
  email: cook.email,
  roles: ["kitchen" as const],
  invitedBy: owner.id,
  expiresAt: new Date("2030-01-01"),
};

function setup(options: { invitation?: typeof pending | null; markAccepted?: boolean; existingMember?: boolean } = {}) {
  const session = { id: "session" };
  const invitations = {
    create: jest.fn(async (_r: string, input: object) => ({ ...pending, ...input, id: "i-new" })),
    revokePendingForEmail: jest.fn(),
    listPending: jest.fn(async () => [pending]),
    revoke: jest.fn(async () => false),
    findPendingByTokenHash: jest.fn(async () => (options.invitation === undefined ? pending : options.invitation)),
    markAccepted: jest.fn(async () => options.markAccepted ?? true),
  };
  const memberships = {
    findOne: jest.fn(async (_r: string, userId: string) =>
      options.existingMember || userId === cook.id ? { restaurantId: "r1", userId, roles: ["kitchen"], joinedAt: new Date() } : null,
    ),
    addRoles: jest.fn(),
  };
  const restaurants = { findById: jest.fn(async () => restaurant) };
  const users = {
    findByEmail: jest.fn(async (email: string) => (email === cook.email && options.existingMember ? cook : null)),
    findById: jest.fn(async (id: string) => (id === owner.id ? owner : id === cook.id ? cook : null)),
    findByIds: jest.fn(async () => [owner]),
    markEmailVerified: jest.fn(),
  };
  const emails = { send: jest.fn() };
  const connection = { transaction: (fn: (s: unknown) => Promise<unknown>) => fn(session) };
  const config = { get: () => "https://munchmate.cl" } as unknown as ConfigService<ApiEnv, true>;
  const service = new InvitationsService(
    invitations as unknown as InvitationsRepository,
    memberships as unknown as MembershipsRepository,
    restaurants as unknown as RestaurantsRepository,
    users as unknown as UsersRepository,
    emails as unknown as EmailQueue,
    connection as unknown as Connection,
    fakeMedia,
    config,
  );
  return { service, invitations, memberships, users, emails, session };
}

describe("InvitationsService", () => {
  it("replaces earlier invitations, stores only the hash and emails the raw link", async () => {
    const { service, invitations, emails } = setup();

    const view = await service.invite("r1", owner.id, { email: cook.email, roles: ["kitchen"] });

    expect(invitations.revokePendingForEmail).toHaveBeenCalledWith("r1", cook.email);
    const [[, stored]] = invitations.create.mock.calls as unknown as [[string, { tokenHash: string }]];
    const [[job, key]] = emails.send.mock.calls as unknown as [[{ data: { url: string } }, string]];
    const token = new URL(job.data.url).searchParams.get("token")!;
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(job.data.url.startsWith("https://munchmate.cl/invitacion?token=")).toBe(true);
    expect(key).toBe("staff-invitation-i-new");
    expect(view.invitedByName).toBe("Dueña");
  });

  it("refuses to invite an existing member", async () => {
    const { service } = setup({ existingMember: true });

    await expect(service.invite("r1", owner.id, { email: cook.email, roles: ["cashier"] })).rejects.toThrow(
      ConflictException,
    );
  });

  it("lists pending invitations with the inviter's name", async () => {
    const { service } = setup();

    await expect(service.listPending("r1")).resolves.toEqual([
      expect.objectContaining({ id: "i1", invitedByName: "Dueña", expiresAt: "2030-01-01T00:00:00.000Z" }),
    ]);
  });

  it("reports revoking a non-pending invitation as not found", async () => {
    const { service } = setup();

    await expect(service.revoke("r1", "i1")).rejects.toThrow(NotFoundException);
  });

  it("previews a valid token and rejects an invalid one", async () => {
    await expect(setup().service.preview("t")).resolves.toMatchObject({ restaurantName: "Sanguchería" });
    await expect(setup({ invitation: null }).service.preview("t")).rejects.toThrow(BadRequestException);
  });

  describe("accept", () => {
    it("joins with the invited roles and verifies the email in one transaction", async () => {
      const { service, memberships, users, session } = setup();

      const view = await service.accept("t", cook.id);

      expect(memberships.addRoles).toHaveBeenCalledWith("r1", cook.id, ["kitchen"], session);
      expect(users.markEmailVerified).toHaveBeenCalledWith(cook.id, session);
      expect(view).toMatchObject({ id: "r1", myRoles: ["kitchen"] });
    });

    it("rejects a user whose email is not the invited one, without consuming the invitation", async () => {
      const { service, invitations } = setup();

      await expect(service.accept("t", owner.id)).rejects.toThrow(ForbiddenException);
      expect(invitations.markAccepted).not.toHaveBeenCalled();
    });

    it("rejects when another request accepted it first", async () => {
      const { service, memberships } = setup({ markAccepted: false });

      await expect(service.accept("t", cook.id)).rejects.toThrow(BadRequestException);
      expect(memberships.addRoles).not.toHaveBeenCalled();
    });
  });
});
