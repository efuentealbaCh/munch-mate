import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import request from "supertest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { configureApp } from "../src/app.setup";

// Same images as compose.yaml, so tests run against the production versions.
const MONGO_IMAGE = "mongo:8.0.32";
const VALKEY_IMAGE = "valkey/valkey:8.1.10-alpine";
const VALKEY_PASSWORD = "test-password";

describe("GET /api/health (e2e)", () => {
  let mongo: StartedMongoDBContainer;
  let valkey: StartedTestContainer;
  let app: INestApplication;

  beforeAll(async () => {
    [mongo, valkey] = await Promise.all([
      new MongoDBContainer(MONGO_IMAGE).start(),
      new GenericContainer(VALKEY_IMAGE)
        .withCommand(["valkey-server", "--requirepass", VALKEY_PASSWORD])
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
        .start(),
    ]);

    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "warn";
    process.env.MONGODB_URI = `${mongo.getConnectionString()}/munchmate_test?directConnection=true`;
    process.env.VALKEY_URL = `redis://:${VALKEY_PASSWORD}@${valkey.getHost()}:${valkey.getMappedPort(6379)}`;

    // ConfigModule.forRoot() validates the environment when app.module is first loaded, so it must be
    // required only after the container URLs are in process.env.
    const { AppModule } = require("../src/app.module") as typeof import("../src/app.module");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
  });

  it("returns 200 with every dependency up", async () => {
    const response = await request(app.getHttpServer()).get("/api/health").expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      info: { mongo: { status: "up" }, valkey: { status: "up" } },
    });
  });

  it("returns 503 and reports valkey down when Valkey is unreachable", async () => {
    await valkey.stop();

    const response = await request(app.getHttpServer()).get("/api/health").expect(503);

    expect(response.body).toMatchObject({
      status: "error",
      error: { valkey: { status: "down" } },
      info: { mongo: { status: "up" } },
    });
  });
});
