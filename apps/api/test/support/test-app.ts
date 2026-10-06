import { type EmailJob, type EmailTemplate, QUEUES } from "@app/types";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { configureApp } from "../../src/app.setup";

// Same images as compose.yaml, so tests run against the production versions.
const MONGO_IMAGE = "mongo:8.0.32";
const VALKEY_IMAGE = "valkey/valkey:8.1.10-alpine";
const VALKEY_PASSWORD = "test-password";

/** Origin the test app believes it is served from (plain http → cookies without Secure, like `pnpm dev`). */
export const TEST_APP_URL = "http://localhost:3100";

export interface TestContext {
  app: NestExpressApplication;
  mongo: StartedMongoDBContainer;
  valkey: StartedTestContainer;
  valkeyUrl: string;
  /** Closes the app and stops the containers that are still running. */
  close(): Promise<void>;
}

/**
 * Starts MongoDB (replica set) and Valkey in Docker and boots the full AppModule against them,
 * configured exactly like production through `configureApp`.
 */
export async function createTestApp(): Promise<TestContext> {
  const [mongo, valkey] = await Promise.all([
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
  process.env.MONGODB_URI = `${mongo.getConnectionString()}/munchmate_test?directConnection=true`;
  process.env.VALKEY_URL = valkeyUrl;
  process.env.APP_URL = TEST_APP_URL;
  process.env.JWT_ACCESS_SECRET = "test-secret-".padEnd(64, "x");

  // ConfigModule.forRoot() validates the environment when app.module is first loaded, so it must be
  // required only after the container URLs are in process.env.
  const { AppModule } = require("../../src/app.module") as typeof import("../../src/app.module");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app);
  await app.init();

  return {
    app,
    mongo,
    valkey,
    valkeyUrl,
    async close() {
      await app.close();
      await Promise.allSettled([mongo.stop(), valkey.stop()]);
    },
  };
}

/**
 * Reads the emails the api enqueued (no workers run in these tests, so jobs stay in the queue).
 * @returns Jobs of the given template sent to `to`, oldest first.
 */
export async function enqueuedEmails<T extends EmailTemplate>(
  valkeyUrl: string,
  template: T,
  to: string,
): Promise<Extract<EmailJob, { template: T }>[]> {
  const queue = new Queue<EmailJob>(QUEUES.EMAIL, { connection: { url: valkeyUrl } });
  try {
    const jobs = await queue.getJobs(["waiting", "delayed", "prioritized"], 0, -1, true);
    return jobs
      .map((job) => job.data)
      .filter((data): data is Extract<EmailJob, { template: T }> => data.template === template && data.data.to === to);
  } finally {
    await queue.close();
  }
}

/**
 * Deletes the throttler counters (keys `throttle:*`), leaving queues untouched. Every request in the tests
 * comes from the same IP, so without this the per-minute limits leak from one test into the next.
 */
export async function resetRateLimits(valkeyUrl: string): Promise<void> {
  const valkey = new Redis(valkeyUrl);
  try {
    let cursor = "0";
    do {
      const [next, keys] = await valkey.scan(cursor, "MATCH", "throttle:*", "COUNT", 500);
      if (keys.length > 0) await valkey.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  } finally {
    await valkey.quit();
  }
}

/** Extracts the `token` query parameter of the most recent email link of a template. */
export async function lastEmailToken(valkeyUrl: string, template: EmailTemplate, to: string): Promise<string> {
  const emails = await enqueuedEmails(valkeyUrl, template, to);
  const url = emails.at(-1)?.data.url;
  const token = url ? new URL(url).searchParams.get("token") : null;
  if (!token) throw new Error(`no ${template} email for ${to}`);
  return token;
}
