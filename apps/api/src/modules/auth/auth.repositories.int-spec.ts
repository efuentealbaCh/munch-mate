import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import mongoose, { type Connection } from "mongoose";
import { hashToken } from "../../common/crypto/tokens";
import { User, UserSchema } from "../users/schemas/user.schema";
import { EmailTakenError, UsersRepository } from "../users/users.repository";
import { OneTimeTokensRepository } from "./one-time-tokens.repository";
import { OneTimeToken, OneTimeTokenSchema } from "./schemas/one-time-token.schema";
import { Session, SessionSchema } from "./schemas/session.schema";
import { SessionsRepository } from "./sessions.repository";

const MONGO_IMAGE = "mongo:8.0.32";

describe("auth repositories (integration)", () => {
  let container: StartedMongoDBContainer;
  let connection: Connection;
  let users: UsersRepository;
  let sessions: SessionsRepository;
  let tokens: OneTimeTokensRepository;

  beforeAll(async () => {
    container = await new MongoDBContainer(MONGO_IMAGE).start();
    connection = await mongoose
      .createConnection(`${container.getConnectionString()}/auth_int?directConnection=true`)
      .asPromise();

    const userModel = connection.model(User.name, UserSchema);
    const sessionModel = connection.model(Session.name, SessionSchema);
    const tokenModel = connection.model(OneTimeToken.name, OneTimeTokenSchema);
    // Build the unique/TTL indexes before testing behavior that depends on them.
    await Promise.all([userModel.init(), sessionModel.init(), tokenModel.init()]);

    users = new UsersRepository(userModel);
    sessions = new SessionsRepository(sessionModel);
    tokens = new OneTimeTokensRepository(tokenModel);
  });

  afterAll(async () => {
    await connection?.close();
    await container?.stop();
  });

  describe("UsersRepository", () => {
    it("lets only one of two concurrent registrations with the same email succeed", async () => {
      const attempts = await Promise.allSettled([
        users.create({ email: "race@example.com", name: "A", passwordHash: "h" }),
        users.create({ email: "RACE@example.com", name: "B", passwordHash: "h" }),
      ]);

      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
      const rejected = attempts.find((a): a is PromiseRejectedResult => a.status === "rejected");
      expect(rejected?.reason).toBeInstanceOf(EmailTakenError);
    });

    it("finds users by email case-insensitively and keeps the first verification date", async () => {
      const created = await users.create({ email: "case@example.com", name: "C", passwordHash: "h" });

      expect((await users.findByEmail("  CASE@Example.com "))?.id).toBe(created.id);

      await users.markEmailVerified(created.id);
      const firstDate = (await users.findById(created.id))?.emailVerifiedAt;
      await users.markEmailVerified(created.id);
      expect((await users.findById(created.id))?.emailVerifiedAt).toEqual(firstDate);
    });

    it("returns null for malformed ids instead of throwing", async () => {
      await expect(users.findById("not-an-object-id")).resolves.toBeNull();
    });
  });

  describe("SessionsRepository", () => {
    const newSession = (familyId: string, userId = new mongoose.Types.ObjectId().toString()) =>
      sessions.create({
        userId,
        familyId,
        tokenHash: hashToken(`${familyId}-${Math.random()}`),
        expiresAt: new Date(Date.now() + 60_000),
        userAgent: null,
        ip: null,
      });

    it("lets only one of several concurrent rotations win", async () => {
      const session = await newSession("family-race");

      const results = await Promise.all(Array.from({ length: 5 }, () => sessions.markRotated(session.id)));

      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("revokes a family and every session of a user", async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const a = await newSession("family-a", userId);
      const b = await newSession("family-b", userId);

      await sessions.revokeFamily("family-a");
      expect(await sessions.markRotated(a.id)).toBe(false);
      expect(await sessions.markRotated(b.id)).toBe(true);

      const c = await newSession("family-c", userId);
      await sessions.revokeAllForUser(userId);
      expect(await sessions.markRotated(c.id)).toBe(false);
    });
  });

  describe("OneTimeTokensRepository", () => {
    const userId = new mongoose.Types.ObjectId().toString();
    const create = (raw: string, expiresInMs = 60_000) =>
      tokens.create({
        type: "verify_email",
        userId,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + expiresInMs),
      });

    it("can be consumed exactly once, even concurrently", async () => {
      await create("once");

      const results = await Promise.all([
        tokens.consume("verify_email", hashToken("once")),
        tokens.consume("verify_email", hashToken("once")),
      ]);

      expect(results.filter((r) => r === userId)).toHaveLength(1);
      expect(results.filter((r) => r === null)).toHaveLength(1);
    });

    it("rejects expired tokens and tokens of another type", async () => {
      await create("expired", -1000);
      await create("typed");

      await expect(tokens.consume("verify_email", hashToken("expired"))).resolves.toBeNull();
      await expect(tokens.consume("password_reset", hashToken("typed"))).resolves.toBeNull();
    });

    it("invalidatePending disables every unused token of that type", async () => {
      await create("pending-1");
      await create("pending-2");

      await tokens.invalidatePending("verify_email", userId);

      await expect(tokens.consume("verify_email", hashToken("pending-1"))).resolves.toBeNull();
      await expect(tokens.consume("verify_email", hashToken("pending-2"))).resolves.toBeNull();
    });
  });
});
