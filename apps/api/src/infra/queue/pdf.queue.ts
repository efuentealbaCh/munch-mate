import { randomBytes } from "node:crypto";
import { QUEUES, type QrSheetJob, type ReceiptJob } from "@app/types";
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";

export type PdfJobState = "pending" | "completed" | "failed";

/** `receipt-<orderId>` for the original order (the id used before item edits existed), then `-r<revision>`. */
const receiptJobId = (orderId: string, revision: number) =>
  revision > 0 ? `receipt-${orderId}-r${revision}` : `receipt-${orderId}`;

@Injectable()
export class PdfQueue {
  constructor(@InjectQueue(QUEUES.PDF) private readonly queue: Queue<QrSheetJob | ReceiptJob>) {}

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

  /**
   * Receipt of an accepted order. The job id is per order and revision, so accepting twice (or a retried
   * request) never generates — or emails — a second receipt, while an edited order gets a new one.
   */
  async enqueueReceipt(job: ReceiptJob): Promise<void> {
    await this.queue.add("receipt", job, {
      jobId: receiptJobId(job.orderId, job.revision),
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: false,
    });
  }

  /**
   * True when the receipt job of an order's revision exhausted its retries (the PDF will never appear by
   * itself).
   */
  async receiptFailed(orderId: string, revision: number): Promise<boolean> {
    const job = await this.queue.getJob(receiptJobId(orderId, revision));
    return job ? (await job.getState()) === "failed" : false;
  }

  /** @returns null when the QR-sheet job does not exist (expired or never created). */
  async find(jobId: string): Promise<{ state: PdfJobState; data: QrSheetJob } | null> {
    const job = await this.queue.getJob(jobId);
    if (!job || job.name !== "qr-sheet") return null;
    const state = await job.getState();
    return {
      state: state === "completed" ? "completed" : state === "failed" ? "failed" : "pending",
      data: job.data as QrSheetJob,
    };
  }
}
