import type { PingJob, PingJobResult } from "@app/types";
import { QUEUES } from "@app/types";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";

/** Infrastructure jobs. `ping` proves that a job travels producer → Valkey → workers and back. */
@Processor(QUEUES.SYSTEM)
export class SystemProcessor extends WorkerHost {
  /**
   * @param job Job from the `system` queue.
   * @returns The job result stored by BullMQ.
   * @throws Error for unknown job names, so they end up in the failed set instead of silently succeeding.
   */
  async process(job: Job<PingJob>): Promise<PingJobResult> {
    if (job.name === "ping") {
      return { pong: true, receivedAt: new Date().toISOString() };
    }
    throw new Error(`Unknown job "${job.name}" in queue "${QUEUES.SYSTEM}"`);
  }
}
