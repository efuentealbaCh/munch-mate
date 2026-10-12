import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { type EmailJob, type PingJob, type PingJobResult, type QrSheetJob, QUEUES, type ReceiptJob } from "@app/types";
import { Test, type TestingModule } from "@nestjs/testing";
import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { type StartedGarage, startGarage } from "../test/garage";
import { HealthServer } from "./health/health.server";

// Same images as compose.yaml / compose.dev.yaml, so tests run against the production versions.
const MONGO_IMAGE = "mongo:8.0.32";
const VALKEY_IMAGE = "valkey/valkey:8.1.10-alpine";
const MAILPIT_IMAGE = "axllent/mailpit:v1.31.4";
const VALKEY_PASSWORD = "test-password";

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

describe("workers (integration)", () => {
  let mongo: StartedMongoDBContainer;
  let valkey: StartedTestContainer;
  let mailpit: StartedTestContainer;
  let garage: StartedGarage;
  let app: TestingModule;
  let valkeyUrl: string;
  const queues: { close(): Promise<void> }[] = [];

  /** Opens a producer and an events listener on a queue; both are closed in afterAll. */
  async function producer<T, R>(name: string) {
    const queue = new Queue<T, R>(name, { connection: { url: valkeyUrl } });
    const events = new QueueEvents(name, { connection: { url: valkeyUrl } });
    await events.waitUntilReady();
    queues.push(queue, events);
    return { queue, events };
  }

  const mailpitApi = (path: string) =>
    fetch(`http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}/api/v1${path}`);

  beforeAll(async () => {
    [mongo, valkey, mailpit, garage] = await Promise.all([
      new MongoDBContainer(MONGO_IMAGE).start(),
      new GenericContainer(VALKEY_IMAGE)
        .withCommand(["valkey-server", "--requirepass", VALKEY_PASSWORD, "--maxmemory-policy", "noeviction"])
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
        .start(),
      new GenericContainer(MAILPIT_IMAGE)
        .withExposedPorts(1025, 8025)
        .withWaitStrategy(Wait.forHttp("/livez", 8025))
        .start(),
      startGarage(),
    ]);

    valkeyUrl = `redis://:${VALKEY_PASSWORD}@${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
    Object.assign(process.env, {
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      HEALTH_PORT: "0",
      MONGODB_URI: `${mongo.getConnectionString()}/munchmate_test?directConnection=true`,
      VALKEY_URL: valkeyUrl,
      SMTP_HOST: mailpit.getHost(),
      SMTP_PORT: String(mailpit.getMappedPort(1025)),
      SMTP_SECURE: "false",
      MAIL_FROM: "Munch Mate <no-reply@munchmate.test>",
      ...garage.env,
    });

    // ConfigModule.forRoot() validates the environment when app.module is first loaded, so it must be
    // required only after the container URLs are in process.env.
    const { AppModule } = require("./app.module") as typeof import("./app.module");
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
  });

  afterAll(async () => {
    await Promise.all(queues.map((q) => q.close()));
    await app?.close();
    await Promise.allSettled([mongo?.stop(), valkey?.stop(), mailpit?.stop(), garage?.container.stop()]);
  });

  describe("system queue", () => {
    it("processes a ping job enqueued by a producer", async () => {
      const { queue, events } = await producer<PingJob, PingJobResult>(QUEUES.SYSTEM);

      const job = await queue.add("ping", { sentAt: new Date().toISOString() });

      await expect(job.waitUntilFinished(events, 10_000)).resolves.toMatchObject({ pong: true });
    });

    it("moves unknown jobs to the failed set", async () => {
      const { queue, events } = await producer<PingJob, PingJobResult>(QUEUES.SYSTEM);

      const job = await queue.add("unknown" as "ping", { sentAt: new Date().toISOString() });

      await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow('Unknown job "unknown"');
    });
  });

  describe("pdf queue", () => {
    it("renders the QR sheet into the private bucket and announces it in real time", async () => {
      const { queue, events } = await producer<QrSheetJob, { key: string }>(QUEUES.PDF);
      const restaurantId = "665f1f77bcf86cd799439011";
      const outputKey = `restaurants/${restaurantId}/qr-sheets/test.pdf`;
      // Listen on Valkey the way the Socket.IO adapter of the api does.
      const subscriber = new Redis(valkeyUrl);
      const announced = new Promise<string>((resolve) => {
        subscriber.on("pmessage", (_pattern: string, channel: string) => resolve(channel));
      });
      await subscriber.psubscribe("socket.io#*");

      const job = await queue.add("qr-sheet", {
        restaurantId,
        restaurantName: "Sanguchería",
        tables: [
          { label: "Mesa 1", url: "https://munchmate.test/m/abcdefghjk" },
          { label: "Mesa 2", url: "https://munchmate.test/m/mnpqrstuvw" },
        ],
        outputKey,
      });
      await job.waitUntilFinished(events, 20_000);

      const s3 = new S3Client({
        endpoint: garage.env.S3_ENDPOINT,
        region: garage.env.S3_REGION,
        forcePathStyle: true,
        credentials: { accessKeyId: garage.env.S3_ACCESS_KEY_ID, secretAccessKey: garage.env.S3_SECRET_ACCESS_KEY },
      });
      const object = await s3.send(new GetObjectCommand({ Bucket: garage.env.S3_BUCKET, Key: outputKey }));
      const pdf = Buffer.from(await object.Body!.transformToByteArray());
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(object.ContentType).toBe("application/pdf");
      expect(await announced).toContain(`restaurant:${restaurantId}`);

      s3.destroy();
      subscriber.disconnect();
    });

    it("stores the receipt, announces it and emails it as an attachment exactly once", async () => {
      const { queue, events } = await producer<ReceiptJob, { key: string }>(QUEUES.PDF);
      const emailEvents = new QueueEvents(QUEUES.EMAIL, { connection: { url: valkeyUrl } });
      await emailEvents.waitUntilReady();
      queues.push(emailEvents);
      const restaurantId = "665f1f77bcf86cd799439011";
      const orderId = "665f1f77bcf86cd799439099";
      const outputKey = `restaurants/${restaurantId}/receipts/${orderId}.pdf`;
      const subscriber = new Redis(valkeyUrl);
      // Emitting to several rooms publishes on the namespace channel; the rooms travel inside the message.
      const announced = new Promise<string>((resolve) => {
        subscriber.on("pmessageBuffer", (_pattern: Buffer, _channel: Buffer, message: Buffer) => {
          if (message.includes("order.receipt-ready")) resolve(message.toString("latin1"));
        });
      });
      await subscriber.psubscribe("socket.io#*");
      const data: ReceiptJob = {
        restaurantId,
        orderId,
        outputKey,
        receipt: {
          restaurant: { name: "Sanguchería", phone: "+56 2 2345 6789" },
          number: 41,
          ticketNumber: 3,
          channel: "pickup",
          createdAt: "2026-10-07T16:48:00Z",
          estimatedReadyAt: "2026-10-07T17:03:00Z",
          timezone: "America/Santiago",
          customerName: "Berta",
          customerPhone: "+56912345678",
          items: [
            {
              productId: "p1",
              name: "Completo italiano",
              unitPrice: 3490,
              quantity: 2,
              modifiers: [],
              note: "",
              lineTotal: 6980,
            },
          ],
          subtotal: 6980,
          deliveryFee: 0,
          total: 6980,
          currency: "CLP",
          delivery: null,
          expectedPayment: null,
          note: "",
        },
        email: { to: "berta@example.com", trackingUrl: "https://munchmate.test/pedido#t=tok123" },
      };

      // Twice, as a retried or duplicated job would: one PDF (same key) and one email (deterministic job id).
      for (const attempt of [1, 2]) {
        const job = await queue.add("receipt", data, { jobId: `receipt-test-${attempt}` });
        await job.waitUntilFinished(events, 20_000);
      }
      const emailQueue = new Queue(QUEUES.EMAIL, { connection: { url: valkeyUrl } });
      queues.push(emailQueue);
      const emailJob = await emailQueue.getJob(`order-confirmation-${orderId}`);
      await emailJob!.waitUntilFinished(emailEvents, 20_000);

      const announcement = await announced;
      expect(announcement).toContain(`order:${orderId}`);
      expect(announcement).toContain(`restaurant:${restaurantId}`);
      const list = (await (await mailpitApi("/messages")).json()) as { messages: (MailpitMessage & { Attachments: number })[] };
      const sent = list.messages.filter((m) => m.To.some((to) => to.Address === "berta@example.com"));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.Subject).toBe("Tu pedido #3 en Sanguchería fue aceptado");
      expect(sent[0]!.Attachments).toBe(1);
      const full = (await (await mailpitApi(`/message/${sent[0]!.ID}`)).json()) as {
        Text: string;
        Attachments: { FileName: string; ContentType: string }[];
      };
      expect(full.Text).toContain("aproximadamente a las 14:03");
      expect(full.Attachments[0]).toMatchObject({ FileName: "comprobante-pedido-41.pdf", ContentType: "application/pdf" });

      subscriber.disconnect();
    });
  });

  describe("email queue", () => {
    it("delivers the email through SMTP with the link intact", async () => {
      const { queue, events } = await producer<EmailJob, { messageId: string }>(QUEUES.EMAIL);
      const url = "https://munchmate.test/verificar-email?token=abc123";

      const job = await queue.add("verify-email", {
        template: "verify-email",
        data: { to: "ana@example.com", name: "Ana", url },
      });
      await job.waitUntilFinished(events, 15_000);

      const list = (await (await mailpitApi("/messages")).json()) as { messages: MailpitMessage[] };
      const message = list.messages.find((m) => m.To.some((to) => to.Address === "ana@example.com"));
      expect(message?.Subject).toMatch(/Confirma tu correo/);

      const full = (await (await mailpitApi(`/message/${message?.ID}`)).json()) as { Text: string };
      expect(full.Text).toContain(url);
    });
  });

  it("serves GET /health with every dependency and queue up", async () => {
    const port = app.get(HealthServer).port;

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      mongo: "up",
      valkey: "up",
      queues: {
        [QUEUES.SYSTEM]: "running",
        [QUEUES.EMAIL]: "running",
        [QUEUES.PDF]: "running",
        [QUEUES.NOTIF]: "running",
      },
    });
  });
});
