import { type PingJob, type PingJobResult, QUEUES } from "@app/types";
import { Test, type TestingModule } from "@nestjs/testing";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import { Queue, QueueEvents } from "bullmq";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { HealthServer } from "../health/health.server";

// Same images as compose.yaml, so tests run against the production versions.
const MONGO_IMAGE = "mongo:8.0.32";
const VALKEY_IMAGE = "valkey/valkey:8.1.10-alpine";
const VALKEY_PASSWORD = "test-password";

describe("workers (integration)", () => {
  let mongo: StartedMongoDBContainer;
  let valkey: StartedTestContainer;
  let app: TestingModule;
  let queue: Queue<PingJob, PingJobResult>;
  let queueEvents: QueueEvents;

  beforeAll(async () => {
    [mongo, valkey] = await Promise.all([
      new MongoDBContainer(MONGO_IMAGE).start(),
      new GenericContainer(VALKEY_IMAGE)
        .withCommand(["valkey-server", "--requirepass", VALKEY_PASSWORD, "--maxmemory-policy", "noeviction"])
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
        .start(),
    ]);

    const valkeyUrl = `redis://:${VALKEY_PASSWORD}@${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "warn";
    process.env.HEALTH_PORT = "0";
    process.env.MONGODB_URI = `${mongo.getConnectionString()}/munchmate_test?directConnection=true`;
    process.env.VALKEY_URL = valkeyUrl;

    // ConfigModule.forRoot() validates the environment when app.module is first loaded, so it must be
    // required only after the container URLs are in process.env.
    const { AppModule } = require("../app.module") as typeof import("../app.module");
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();

    queue = new Queue(QUEUES.SYSTEM, { connection: { url: valkeyUrl } });
    queueEvents = new QueueEvents(QUEUES.SYSTEM, { connection: { url: valkeyUrl } });
    await queueEvents.waitUntilReady();
  });

  afterAll(async () => {
    await queueEvents?.close();
    await queue?.close();
    await app?.close();
    await Promise.all([mongo?.stop(), valkey?.stop()]);
  });

  it("processes a ping job enqueued by a producer", async () => {
    const job = await queue.add("ping", { sentAt: new Date().toISOString() });

    const result = await job.waitUntilFinished(queueEvents, 10_000);

    expect(result).toMatchObject({ pong: true });
  });

  it("moves unknown jobs to the failed set", async () => {
    const job = await queue.add("unknown" as "ping", { sentAt: new Date().toISOString() });

    await expect(job.waitUntilFinished(queueEvents, 10_000)).rejects.toThrow('Unknown job "unknown"');
  });

  it("serves GET /health with every dependency up", async () => {
    const port = app.get(HealthServer).port;

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      mongo: "up",
      valkey: "up",
      queues: { [QUEUES.SYSTEM]: "running" },
    });
  });
});
