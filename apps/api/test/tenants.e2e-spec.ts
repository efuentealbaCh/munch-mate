import type { RestaurantView } from "@app/types";
import { Types } from "mongoose";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import {
  createTestApp,
  enqueuedEmails,
  lastEmailToken,
  resetRateLimits,
  type TestContext,
} from "./support/test-app";

const PASSWORD = "correct horse battery";

describe("Restaurants, members and invitations (e2e)", () => {
  let ctx: TestContext;
  let server: ReturnType<TestContext["app"]["getHttpServer"]>;
  let counter = 0;

  const newEmail = (prefix = "user") => `${prefix}${++counter}-${Date.now()}@example.com`;

  /** Registers a user (with a cookie-keeping agent) and, unless told otherwise, verifies the email. */
  async function user(options: { verified?: boolean; email?: string; name?: string } = {}) {
    const email = options.email ?? newEmail();
    const agent = request.agent(server);
    await agent
      .post("/api/auth/register")
      .send({ email, password: PASSWORD, name: options.name ?? "Ana" })
      .expect(201);
    if (options.verified !== false) {
      const token = await lastEmailToken(ctx.valkeyUrl, "verify-email", email);
      await request(server).post("/api/auth/verify-email").send({ token }).expect(204);
    }
    return { agent, email };
  }

  async function restaurantOf(agent: TestAgent, name = "La Picá de Juan"): Promise<RestaurantView> {
    return (await agent.post("/api/restaurants").send({ name }).expect(201)).body as RestaurantView;
  }

  /** Invites `email` and returns the token from the enqueued email. */
  async function invite(owner: TestAgent, restaurantId: string, email: string, roles = ["kitchen"]) {
    await owner.post(`/api/restaurants/${restaurantId}/invitations`).send({ email, roles }).expect(201);
    return lastEmailToken(ctx.valkeyUrl, "staff-invitation", email);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer();
  });

  beforeEach(async () => {
    await resetRateLimits(ctx.valkeyUrl);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  describe("creating restaurants", () => {
    it("requires a verified email", async () => {
      const { agent } = await user({ verified: false });

      const res = await agent.post("/api/restaurants").send({ name: "Sin verificar" }).expect(403);

      expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
    });

    it("derives the slug from the name, with Chilean defaults, and makes the creator owner", async () => {
      const { agent } = await user();

      const restaurant = await restaurantOf(agent, "Café Ñuñoa Único");

      expect(restaurant).toMatchObject({
        name: "Café Ñuñoa Único",
        slug: "cafe-nunoa-unico",
        currency: "CLP",
        timezone: "America/Santiago",
        status: "active",
        myRoles: ["owner"],
      });
    });

    it("suffixes generated slugs that are taken", async () => {
      const first = await restaurantOf((await user()).agent, "Fuente Suiza");
      const second = await restaurantOf((await user()).agent, "Fuente Suiza");

      expect(first.slug).toBe("fuente-suiza");
      expect(second.slug).toBe("fuente-suiza-2");
    });

    it("rejects a chosen slug that is taken and suggests a free one", async () => {
      await restaurantOf((await user()).agent, "El Hoyo");
      const { agent } = await user();

      const res = await agent.post("/api/restaurants").send({ name: "Otro Hoyo", slug: "el-hoyo" }).expect(409);

      expect(res.body).toMatchObject({ code: "SLUG_TAKEN", meta: { suggestion: "el-hoyo-2" } });
    });

    it.each([
      ["admin", "reserved"],
      ["La Pica", "invalid characters"],
      ["ab", "too short"],
    ])("rejects the slug %s (%s)", async (slug) => {
      const { agent } = await user();

      const res = await agent.post("/api/restaurants").send({ name: "Válido", slug }).expect(400);

      expect(res.body.code).toBe("INVALID_SLUG");
    });

    it("prefixes names that produce an unusable slug instead of failing", async () => {
      const { agent } = await user();

      expect((await restaurantOf(agent, "Admin")).slug).toBe("restaurante-admin");
    });

    it("reports slug availability for the form", async () => {
      await restaurantOf((await user()).agent, "Dominó");
      const { agent } = await user();

      const taken = await agent.get("/api/restaurants/slug-availability").query({ slug: "Domino" }).expect(200);
      const free = await agent.get("/api/restaurants/slug-availability").query({ slug: "domino-centro" });
      const reserved = await agent.get("/api/restaurants/slug-availability").query({ slug: "api" });

      expect(taken.body).toEqual({ slug: "domino", available: false, reason: "taken", suggestion: "domino-2" });
      expect(free.body).toEqual({ slug: "domino-centro", available: true });
      expect(reserved.body).toMatchObject({ available: false, reason: "reserved" });
    });
  });

  describe("tenant isolation", () => {
    it("lists only the user's restaurants and hides other tenants behind 404", async () => {
      const a = await user();
      const b = await user();
      const restaurantA = await restaurantOf(a.agent, "Restaurante A");
      await restaurantOf(b.agent, "Restaurante B");

      const listB = await b.agent.get("/api/restaurants").expect(200);
      expect(listB.body.map((r: RestaurantView) => r.name)).toEqual(["Restaurante B"]);

      const base = `/api/restaurants/${restaurantA.id}`;
      for (const res of [
        await b.agent.get(base),
        await b.agent.patch(base).send({ name: "Hackeado" }),
        await b.agent.get(`${base}/members`),
        await b.agent.post(`${base}/invitations`).send({ email: newEmail(), roles: ["owner"] }),
        await b.agent.get(`/api/restaurants/${new Types.ObjectId().toString()}`),
        await b.agent.get("/api/restaurants/not-an-id"),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe("RESTAURANT_NOT_FOUND");
      }

      expect((await a.agent.get(base).expect(200)).body.name).toBe("Restaurante A");
    });

    it("lets the owner rename and change the slug, rejecting slugs in use", async () => {
      const other = await restaurantOf((await user()).agent, "Ocupado");
      const { agent } = await user();
      const mine = await restaurantOf(agent, "Mi Local");

      const renamed = await agent
        .patch(`/api/restaurants/${mine.id}`)
        .send({ name: "Mi Local Nuevo", slug: "mi-local-nuevo" })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: "Mi Local Nuevo", slug: "mi-local-nuevo" });

      const clash = await agent.patch(`/api/restaurants/${mine.id}`).send({ slug: other.slug }).expect(409);
      expect(clash.body.code).toBe("SLUG_TAKEN");
    });
  });

  describe("invitations", () => {
    it("invites a cook who registers, accepts and gets only kitchen permissions", async () => {
      const owner = await user({ name: "Dueña" });
      const restaurant = await restaurantOf(owner.agent, "Sanguchería");
      const cookEmail = newEmail("cook");

      const token = await invite(owner.agent, restaurant.id, cookEmail, ["kitchen"]);
      const [email] = await enqueuedEmails(ctx.valkeyUrl, "staff-invitation", cookEmail);
      expect(email?.data).toMatchObject({ restaurantName: "Sanguchería", inviterName: "Dueña", roles: ["kitchen"] });

      const pending = await owner.agent.get(`/api/restaurants/${restaurant.id}/invitations`).expect(200);
      expect(pending.body).toEqual([expect.objectContaining({ email: cookEmail, invitedByName: "Dueña" })]);

      const preview = await request(server).post("/api/invitations/preview").send({ token }).expect(200);
      expect(preview.body).toMatchObject({ restaurantName: "Sanguchería", email: cookEmail, roles: ["kitchen"] });

      // The cook has no account yet: registers with the invited email (unverified) and accepts.
      const cook = await user({ email: cookEmail, verified: false });
      const accepted = await cook.agent.post("/api/invitations/accept").send({ token }).expect(200);
      expect(accepted.body).toMatchObject({ id: restaurant.id, myRoles: ["kitchen"] });
      expect((await cook.agent.get("/api/auth/me")).body.emailVerified).toBe(true);

      const base = `/api/restaurants/${restaurant.id}`;
      await cook.agent.get(base).expect(200);
      expect((await cook.agent.patch(base).send({ name: "x" }).expect(403)).body.code).toBe("FORBIDDEN_ROLE");
      await cook.agent.get(`${base}/members`).expect(403);
      await cook.agent.post(`${base}/invitations`).send({ email: newEmail(), roles: ["owner"] }).expect(403);

      await cook.agent.post("/api/invitations/accept").send({ token }).expect(400);
      expect((await owner.agent.get(`${base}/invitations`)).body).toEqual([]);
    });

    it("only the invited email can accept", async () => {
      const owner = await user();
      const restaurant = await restaurantOf(owner.agent);
      const token = await invite(owner.agent, restaurant.id, newEmail("invited"));

      const intruder = await user();
      const res = await intruder.agent.post("/api/invitations/accept").send({ token }).expect(403);

      expect(res.body.code).toBe("INVITATION_EMAIL_MISMATCH");
      await request(server).post("/api/invitations/preview").send({ token }).expect(200); // still pending
    });

    it("a new invitation to the same email replaces the previous one; revoked links stop working", async () => {
      const owner = await user();
      const restaurant = await restaurantOf(owner.agent);
      const email = newEmail("twice");

      const first = await invite(owner.agent, restaurant.id, email);
      const second = await invite(owner.agent, restaurant.id, email);
      await request(server).post("/api/invitations/preview").send({ token: first }).expect(400);

      const [pending] = (await owner.agent.get(`/api/restaurants/${restaurant.id}/invitations`)).body;
      await owner.agent.delete(`/api/restaurants/${restaurant.id}/invitations/${pending.id}`).expect(204);
      await request(server).post("/api/invitations/preview").send({ token: second }).expect(400);
    });

    it("rejects inviting someone who is already a member", async () => {
      const owner = await user();
      const restaurant = await restaurantOf(owner.agent);

      const res = await owner.agent
        .post(`/api/restaurants/${restaurant.id}/invitations`)
        .send({ email: owner.email, roles: ["cashier"] })
        .expect(409);

      expect(res.body.code).toBe("ALREADY_MEMBER");
    });

    it("validates invitation roles", async () => {
      const owner = await user();
      const restaurant = await restaurantOf(owner.agent);

      const res = await owner.agent
        .post(`/api/restaurants/${restaurant.id}/invitations`)
        .send({ email: newEmail(), roles: ["superadmin"] })
        .expect(400);

      expect(res.body.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("members and the last-owner rule", () => {
    /** Owner + a member who accepted an invitation with the given roles. */
    async function team(roles = ["kitchen"]) {
      const owner = await user({ name: "Dueña" });
      const restaurant = await restaurantOf(owner.agent);
      const memberEmail = newEmail("member");
      const token = await invite(owner.agent, restaurant.id, memberEmail, roles);
      const member = await user({ email: memberEmail, name: "Miembro" });
      await member.agent.post("/api/invitations/accept").send({ token }).expect(200);
      const members = (await owner.agent.get(`/api/restaurants/${restaurant.id}/members`)).body;
      const memberId = members.find((m: { email: string }) => m.email === memberEmail).userId as string;
      const ownerId = members.find((m: { email: string }) => m.email === owner.email).userId as string;
      return { owner, member, restaurant, memberId, ownerId, base: `/api/restaurants/${restaurant.id}/members` };
    }

    it("lists members and lets the owner change roles", async () => {
      const { owner, base, memberId } = await team();

      await owner.agent.patch(`${base}/${memberId}`).send({ roles: ["kitchen", "cashier"] }).expect(204);

      const members = (await owner.agent.get(base).expect(200)).body;
      expect(members).toHaveLength(2);
      expect(members.find((m: { userId: string }) => m.userId === memberId).roles).toEqual(["kitchen", "cashier"]);
    });

    it("never leaves a restaurant without owners", async () => {
      const { owner, base, ownerId } = await team();

      const demote = await owner.agent.patch(`${base}/${ownerId}`).send({ roles: ["cashier"] }).expect(409);
      expect(demote.body.code).toBe("LAST_OWNER");
      await owner.agent.delete(`${base}/${ownerId}`).expect(409);
    });

    it("an owner can leave once someone else is owner", async () => {
      const { owner, member, base, ownerId, memberId, restaurant } = await team();
      await owner.agent.patch(`${base}/${memberId}`).send({ roles: ["owner"] }).expect(204);

      await owner.agent.delete(`${base}/${ownerId}`).expect(204);

      await owner.agent.get(`/api/restaurants/${restaurant.id}`).expect(404);
      expect((await member.agent.get(base).expect(200)).body).toHaveLength(1);
    });

    it("staff can leave but cannot remove others", async () => {
      const { member, base, ownerId, memberId, restaurant } = await team();

      await member.agent.delete(`${base}/${ownerId}`).expect(403);
      await member.agent.delete(`${base}/${memberId}`).expect(204);
      await member.agent.get(`/api/restaurants/${restaurant.id}`).expect(404);
    });

    it("two owners demoting each other at the same time cannot both succeed", async () => {
      const { owner, member, base, ownerId, memberId } = await team(["owner"]);

      const results = await Promise.all([
        owner.agent.patch(`${base}/${memberId}`).send({ roles: ["cashier"] }),
        member.agent.patch(`${base}/${ownerId}`).send({ roles: ["cashier"] }),
      ]);

      const statuses = results.map((r) => r.status).sort();
      // One wins (204). The other either conflicts on LAST_OWNER (409) or, having lost its own
      // owner role first, is rejected by the role guard (403).
      expect(statuses[0]).toBe(204);
      expect([403, 409]).toContain(statuses[1]);
      const remaining = await owner.agent.get(base);
      const viewer = remaining.status === 200 ? owner : member;
      const members = (await viewer.agent.get(base).expect(200)).body as { roles: string[] }[];
      expect(members.filter((m) => m.roles.includes("owner"))).toHaveLength(1);
    });
  });
});
