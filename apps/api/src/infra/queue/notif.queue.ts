import { type NotifJob, QUEUES } from "@app/types";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";

@Injectable()
export class NotifQueue {
  constructor(@InjectQueue(QUEUES.NOTIF) private readonly queue: Queue<NotifJob>) {}

  /**
   * Enqueues a web-push notification for the workers.
   * @param idempotencyKey Deterministic per event (e.g. `push-created-<orderId>`): the same event never
   *   notifies twice. Must not contain ":" (reserved by BullMQ).
   */
  async push(job: NotifJob, idempotencyKey: string): Promise<void> {
    await this.queue.add("push", job, {
      jobId: idempotencyKey,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      // A notification is only worth something right away; keep failures for inspection anyway.
      removeOnComplete: { age: 3600 },
      removeOnFail: false,
    });
  }
}
