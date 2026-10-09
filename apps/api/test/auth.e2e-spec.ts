import { getConnectionToken } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import request, { type Response } from "supertest";
import {
  createTestApp,
  enqueuedEmails,
  lastEmailToken,
  resetRateLimits,
  TEST_APP_URL,
  type TestContext,
} from "./support/test-app";

const PASSWORD = "correct horse battery";

/** Parses one cookie from the Set-Cookie headers of a response. */
function cookie(res: Response, name: string): { value: string; attributes: string } | undefined {
  const header = res.headers["set-cookie"] as unknown as string[] | undefined;
  const raw = header?.find((c) => c.startsWith(`${name}=`));
  if (!raw) return undefined;
  const [pair = "", ...attributes] = raw.split("; ");
  return { value: decodeURIComponent(pair.slice(name.length + 1)), attributes: attributes.join("; ") };
}

describe("Auth (e2e)", () => {
  let ctx: TestContext;
  let server: ReturnType<TestContext["app"]["getHttpServer"]>;
  let emailCounter = 0;

  /** Unique address per test, so tests do not depend on each other's data. */
  const newEmail = () => `user${++emailCounter}-${Date.now()}@example.com`;

  /** Registers a user with a cookie-keeping agent. */
  async function registered(email = newEmail()) {
    const agent = request.agent(server);
    const res = await agent.post("/api/auth/register").send({ email, password: PASSWORD, name: "Ana" }).expect(201);
    return { agent, email, res };
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

  describe("registration", () => {
    it("creates the account, logs it in with httpOnly cookies and emails a verification link", async () => {
      const { res, email, agent } = await registered();

      expect(res.body).toEqual({ id: expect.any(String), email, name: "Ana", emailVerified: false, platformRole: null });
      expect(JSON.stringify(res.body)).not.toMatch(/token|hash/i);

      const access = cookie(res, "mm_at");
      const refresh = cookie(res, "mm_rt");
      expect(access?.attributes).toMatch(/HttpOnly/);
      expect(access?.attributes).toMatch(/SameSite=Lax/);
      expect(access?.attributes).toMatch(/Path=\/(;|$)/);
      expect(refresh?.attributes).toMatch(/HttpOnly/);
      expect(refresh?.attributes).toMatch(/SameSite=Strict/);
      expect(refresh?.attributes).toMatch(/Path=\/api\/auth/);

      await agent.get("/api/auth/me").expect(200);
      expect(await enqueuedEmails(ctx.valkeyUrl, "verify-email", email)).toHaveLength(1);
    });

    it("normalizes the email and rejects duplicates regardless of case", async () => {
      const { email } = await registered();

      const res = await request(server)
        .post("/api/auth/register")
        .send({ email: `  ${email.toUpperCase()} `, password: PASSWORD, name: "Otra" })
        .expect(409);

      expect(res.body).toMatchObject({ code: "EMAIL_TAKEN" });
    });

    it("validates the body and reports every invalid field", async () => {
      const res = await request(server)
        .post("/api/auth/register")
        .send({ email: "not-an-email", password: "short", name: "", isAdmin: true })
        .expect(400);

      expect(res.body.code).toBe("VALIDATION_FAILED");
      expect(res.body.details.join(" ")).toMatch(/email/);
      expect(res.body.details.join(" ")).toMatch(/password/);
      expect(res.body.details.join(" ")).toMatch(/isAdmin/); // unknown fields are rejected, not ignored
    });
  });

  describe("email verification", () => {
    it("verifies with the emailed token, which then cannot be reused", async () => {
      const { agent, email } = await registered();
      const token = await lastEmailToken(ctx.valkeyUrl, "verify-email", email);

      await request(server).post("/api/auth/verify-email").send({ token }).expect(204);
      expect((await agent.get("/api/auth/me").expect(200)).body.emailVerified).toBe(true);

      const reused = await request(server).post("/api/auth/verify-email").send({ token }).expect(400);
      expect(reused.body.code).toBe("INVALID_TOKEN");
    });

    it("resending invalidates the previous link", async () => {
      const { agent, email } = await registered();
      const first = await lastEmailToken(ctx.valkeyUrl, "verify-email", email);

      await agent.post("/api/auth/resend-verification").expect(202);
      const second = await lastEmailToken(ctx.valkeyUrl, "verify-email", email);

      expect(second).not.toBe(first);
      await request(server).post("/api/auth/verify-email").send({ token: first }).expect(400);
      await request(server).post("/api/auth/verify-email").send({ token: second }).expect(204);
    });
  });

  describe("login", () => {
    it("returns the same error for a wrong password and an unknown email", async () => {
      const { email } = await registered();

      const wrongPassword = await request(server)
        .post("/api/auth/login")
        .send({ email, password: "wrong password" })
        .expect(401);
      const unknownEmail = await request(server)
        .post("/api/auth/login")
        .send({ email: newEmail(), password: PASSWORD })
        .expect(401);

      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body.code).toBe("INVALID_CREDENTIALS");
    });

    it("rejects requests without a session or with a tampered access token", async () => {
      const anonymous = await request(server).get("/api/auth/me").expect(401);
      expect(anonymous.body.code).toBe("UNAUTHENTICATED");

      await request(server).get("/api/auth/me").set("Cookie", "mm_at=eyJhbGciOiJub25lIn0.e30.").expect(401);
    });
  });

  describe("refresh token rotation", () => {
    it("rotates the refresh token on every use", async () => {
      const { res } = await registered();
      const original = cookie(res, "mm_rt")!.value;

      const refreshed = await request(server)
        .post("/api/auth/refresh")
        .set("Cookie", `mm_rt=${original}`)
        .expect(200);

      const rotated = cookie(refreshed, "mm_rt")!.value;
      expect(rotated).not.toBe(original);
      expect(cookie(refreshed, "mm_at")).toBeDefined();
    });

    it("a concurrent reuse within the grace window fails without logging the user out", async () => {
      const { res } = await registered();
      const original = cookie(res, "mm_rt")!.value;

      const first = await request(server).post("/api/auth/refresh").set("Cookie", `mm_rt=${original}`).expect(200);
      await request(server).post("/api/auth/refresh").set("Cookie", `mm_rt=${original}`).expect(401);

      // The token issued to the first request still works.
      await request(server)
        .post("/api/auth/refresh")
        .set("Cookie", `mm_rt=${cookie(first, "mm_rt")!.value}`)
        .expect(200);
    });

    it("reusing a rotated token after the grace window revokes the whole session family", async () => {
      const { res } = await registered();
      const stolen = cookie(res, "mm_rt")!.value;
      const legit = await request(server).post("/api/auth/refresh").set("Cookie", `mm_rt=${stolen}`).expect(200);
      const legitToken = cookie(legit, "mm_rt")!.value;

      // Simulate time passing beyond ROTATION_GRACE_MS.
      const db = ctx.app.get<Connection>(getConnectionToken());
      await db.collection("sessions").updateMany({ rotatedAt: { $ne: null } }, { $set: { rotatedAt: new Date(0) } });

      const reuse = await request(server).post("/api/auth/refresh").set("Cookie", `mm_rt=${stolen}`).expect(401);
      expect(reuse.body.code).toBe("INVALID_SESSION");
      expect(cookie(reuse, "mm_rt")?.attributes).toMatch(/Expires=Thu, 01 Jan 1970/);

      // The legitimate holder is logged out too: the family is revoked.
      await request(server).post("/api/auth/refresh").set("Cookie", `mm_rt=${legitToken}`).expect(401);
    });

    it("logout revokes the session and clears the cookies", async () => {
      const { agent, res } = await registered();
      const refreshToken = cookie(res, "mm_rt")!.value;

      const out = await agent.post("/api/auth/logout").expect(204);

      expect(cookie(out, "mm_at")?.attributes).toMatch(/Expires=Thu, 01 Jan 1970/);
      await request(server).post("/api/auth/refresh").set("Cookie", `mm_rt=${refreshToken}`).expect(401);
    });
  });

  describe("password reset", () => {
    it("does not reveal whether the email exists", async () => {
      const unknown = newEmail();

      await request(server).post("/api/auth/forgot-password").send({ email: unknown }).expect(202);

      expect(await enqueuedEmails(ctx.valkeyUrl, "password-reset", unknown)).toHaveLength(0);
    });

    it("sets the new password, verifies the email and logs out every device", async () => {
      const { email, res } = await registered();
      const oldRefresh = cookie(res, "mm_rt")!.value;

      await request(server).post("/api/auth/forgot-password").send({ email }).expect(202);
      const token = await lastEmailToken(ctx.valkeyUrl, "password-reset", email);
      await request(server)
        .post("/api/auth/reset-password")
        .send({ token, password: "a brand new passphrase" })
        .expect(204);

      await request(server).post("/api/auth/refresh").set("Cookie", `mm_rt=${oldRefresh}`).expect(401);
      await request(server).post("/api/auth/login").send({ email, password: PASSWORD }).expect(401);
      const login = await request(server)
        .post("/api/auth/login")
        .send({ email, password: "a brand new passphrase" })
        .expect(200);
      expect(login.body.emailVerified).toBe(true);

      await request(server)
        .post("/api/auth/reset-password")
        .send({ token, password: "yet another passphrase" })
        .expect(400);
    });
  });

  describe("CSRF origin check", () => {
    it("rejects state-changing requests from another origin and accepts the app's own", async () => {
      const { email } = await registered();

      const forged = await request(server)
        .post("/api/auth/login")
        .set("Origin", "https://evil.example")
        .send({ email, password: PASSWORD })
        .expect(403);
      expect(forged.body.code).toBe("ORIGIN_NOT_ALLOWED");

      await request(server)
        .post("/api/auth/login")
        .set("Origin", TEST_APP_URL)
        .send({ email, password: PASSWORD })
        .expect(200);
    });
  });

  describe("rate limiting", () => {
    it("blocks the 11th login attempt within a minute", async () => {
      const attempt = () => request(server).post("/api/auth/login").send({ email: newEmail(), password: "x" });
      for (let i = 0; i < 10; i++) await attempt().expect(401);

      const blocked = await attempt().expect(429);
      expect(blocked.body.code).toBe("RATE_LIMITED");
    });
  });
});
