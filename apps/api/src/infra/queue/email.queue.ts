import { type EmailJob, QUEUES } from "@app/types";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";

@Injectable()
export class EmailQueue {
  constructor(@InjectQueue(QUEUES.EMAIL) private readonly queue: Queue<EmailJob>) {}

  /**
   * Enqueues an email for the workers.
   * @param job Template and its data.
   * @param idempotencyKey Deterministic id (e.g. `verify-email-<tokenId>`): enqueuing the same key twice
   *   creates a single job. Must not contain ":" (reserved by BullMQ).
   */
  async send(job: EmailJob, idempotencyKey: string): Promise<void> {
    await this.queue.add(job.template, job, {
      jobId: idempotencyKey,
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: false, // failed jobs stay for inspection (DLQ equivalent)
    });
  }
}
