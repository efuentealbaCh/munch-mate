import type { NotifJob } from "@app/types";
import type { ConfigService } from "@nestjs/config";
import type { Job } from "bullmq";
import type { Connection } from "mongoose";
import type { PinoLogger } from "nestjs-pino";
import webpush, { WebPushError } from "web-push";
import type { WorkersEnv } from "../config/env.validation";
import { NotifProcessor } from "./notif.processor";

jest.mock("web-push", () => {
  class MockWebPushError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
    }
  }
  return { __esModule: true, default: { sendNotification: jest.fn() }, WebPushError: MockWebPushError };
});

const send = webpush.sendNotification as jest.Mock;
const sub = (n: number, host = "fcm.googleapis.com") => ({
  endpoint: `https://${host}/fcm/send/${n}`,
  keys: { p256dh: "p", auth: "a" },
});
const job = (subscriptions: NotifJob["subscriptions"]): Job<NotifJob> =>
  ({
    id: "push-created-o1",
    name: "push",
    data: { subscriptions, notification: { title: "Pedido nuevo #12", body: "Mesa 4", url: "/admin/r1/pedidos", tag: "order-o1" } },
  }) as unknown as Job<NotifJob>;

function setup(keys = true) {
  const deleteOne = jest.fn(async () => ({ deletedCount: 1 }));
  const processor = new NotifProcessor(
    {
      get: (name: string) =>
        keys ? ({ VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@b.c" } as Record<string, string>)[name] : undefined,
    } as unknown as ConfigService<WorkersEnv, true>,
    { collection: () => ({ deleteOne }) } as unknown as Connection,
    { info: jest.fn(), warn: jest.fn() } as unknown as PinoLogger,
  );
  return { processor, deleteOne };
}

describe("NotifProcessor", () => {
  beforeEach(() => send.mockReset());

  it("sends the notification to every subscription with the VAPID keys", async () => {
    send.mockResolvedValue({ statusCode: 201 });

    await expect(setup().processor.process(job([sub(1), sub(2)]))).resolves.toEqual({ sent: 2, removed: 0 });

    expect(send).toHaveBeenCalledWith(
      sub(1),
      expect.stringContaining('"tag":"order-o1"'),
      expect.objectContaining({ urgency: "high", vapidDetails: { subject: "mailto:a@b.c", publicKey: "BPub", privateKey: "priv" } }),
    );
  });

  it("forgets subscriptions the push service reports gone, and keeps going", async () => {
    send.mockRejectedValueOnce(new WebPushError("gone", 410, {}, "", "")).mockResolvedValueOnce({ statusCode: 201 });
    const { processor, deleteOne } = setup();

    await expect(processor.process(job([sub(1), sub(2)]))).resolves.toEqual({ sent: 1, removed: 1 });
    expect(deleteOne).toHaveBeenCalledWith({ endpoint: sub(1).endpoint });
  });

  it("fails the job (to retry) on other errors", async () => {
    send.mockRejectedValueOnce(new Error("network down"));

    await expect(setup().processor.process(job([sub(1)]))).rejects.toThrow("retrying");
  });

  it("never calls endpoints outside the known push services", async () => {
    send.mockResolvedValue({ statusCode: 201 });

    await setup().processor.process(job([sub(1, "valkey:6379"), sub(2, "internal.local")]));

    expect(send).not.toHaveBeenCalled();
  });

  it("skips quietly when VAPID keys are not configured", async () => {
    await expect(setup(false).processor.process(job([sub(1)]))).resolves.toEqual({
      sent: 0,
      removed: 0,
      skipped: "not_configured",
    });
    expect(send).not.toHaveBeenCalled();
  });
});
