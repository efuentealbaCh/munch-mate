import request from "supertest";
import { createTestApp, type TestContext } from "./support/test-app";

describe("GET /api/health (e2e)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it("returns 200 with every dependency up, without a session", async () => {
    const response = await request(ctx.app.getHttpServer()).get("/api/health").expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      info: { mongo: { status: "up" }, valkey: { status: "up" } },
    });
  });

  it("returns 503 and reports valkey down when Valkey is unreachable", async () => {
    await ctx.valkey.stop();

    const response = await request(ctx.app.getHttpServer()).get("/api/health").expect(503);

    expect(response.body).toMatchObject({
      status: "error",
      error: { valkey: { status: "down" } },
      info: { mongo: { status: "up" } },
    });
  });
});
