import { randomBytes } from "node:crypto";
import { QUEUES, type QrSheetJob } from "@app/types";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";

export type PdfJobState = "pending" | "completed" | "failed";

@Injectable()
export class PdfQueue {
  constructor(@InjectQueue(QUEUES.PDF) private readonly queue: Queue<QrSheetJob>) {}

  /** @returns The job id the client polls (or waits for via the `qr-sheet.ready` event). */
  async enqueueQrSheet(job: Omit<QrSheetJob, "outputKey">): Promise<{ jobId: string; outputKey: string }> {
    const jobId = `qr-sheet-${randomBytes(9).toString("base64url")}`;
    const outputKey = `restaurants/${job.restaurantId}/qr-sheets/${jobId}.pdf`;
    await this.queue.add("qr-sheet", { ...job, outputKey }, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 },
      // The PDF itself lives in storage; the job only needs to survive long enough to be downloaded.
      removeOnComplete: { age: 24 * 3600 },
      removeOnFail: false,
    });
    return { jobId, outputKey };
  }

  /** @returns null when the job does not exist (expired or never created). */
  async find(jobId: string): Promise<{ state: PdfJobState; data: QrSheetJob } | null> {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return {
      state: state === "completed" ? "completed" : state === "failed" ? "failed" : "pending",
      data: job.data,
    };
  }
}
