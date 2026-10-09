import type { RestaurantRole, RestaurantView } from "@app/types";
import request from "supertest";
import type TestAgent from "supertest/lib/agent";
import { lastEmailToken, type TestContext } from "./test-app";

export const PASSWORD = "correct horse battery";

/**
 * Builders for the common test setup: verified users, restaurants and staff with roles.
 * Each call creates fresh data with unique emails, so tests do not depend on each other.
 */
export function fixtures(ctx: TestContext) {
  const server = ctx.app.getHttpServer();
  let counter = 0;
  const newEmail = (prefix = "user") => `${prefix}${++counter}-${Date.now()}@example.com`;

  /** Registers a user with a cookie-keeping agent and (by default) verifies the email. */
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

  /** An owner with a fresh restaurant. */
  async function ownerWithRestaurant(name?: string) {
    const owner = await user({ name: "Dueña" });
    const restaurant = await restaurantOf(owner.agent, name);
    return { owner, restaurant };
  }

  /** Invites a new user with the given roles and has them accept. */
  async function staff(owner: TestAgent, restaurantId: string, roles: RestaurantRole[]) {
    const email = newEmail(roles.join("-"));
    await owner.post(`/api/restaurants/${restaurantId}/invitations`).send({ email, roles }).expect(201);
    const token = await lastEmailToken(ctx.valkeyUrl, "staff-invitation", email);
    const member = await user({ email, verified: false });
    await member.agent.post("/api/invitations/accept").send({ token }).expect(200);
    return member;
  }

  return { server, newEmail, user, restaurantOf, ownerWithRestaurant, staff };
}
