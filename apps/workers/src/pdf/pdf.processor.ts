import { type EmailJob, QUEUES, type QrSheetJob, type ReceiptJob } from "@app/types";
import { formatMoney, formatPhone } from "@app/utils";
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job, Queue } from "bullmq";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { PrivateStorageService } from "../storage/private-storage.service";
import { renderQrSheet } from "./qr-sheet";
import { formatTime, renderReceipt } from "./receipt";

type PdfJob = Job<QrSheetJob, unknown, "qr-sheet"> | Job<ReceiptJob, unknown, "receipt">;

/**
 * Generates PDFs and stores them in the private bucket. Idempotent: a retry overwrites the same key, and the
 * follow-up email has a deterministic job id, so it is enqueued once however many times the job runs.
 * Screens are notified through Socket.IO (`qr-sheet.ready`, `order.receipt-ready`) instead of polling.
 */
@Processor(QUEUES.PDF, { concurrency: 2 })
export class PdfProcessor extends WorkerHost {
  constructor(
    private readonly storage: PrivateStorageService,
    private readonly realtime: RealtimeEmitterService,
    @InjectQueue(QUEUES.EMAIL) private readonly emailQueue: Queue<EmailJob>,
    @InjectPinoLogger(PdfProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async process(job: PdfJob): Promise<{ key: string }> {
    switch (job.name) {
      case "qr-sheet":
        return this.qrSheet(job as Job<QrSheetJob>);
      case "receipt":
        return this.receipt(job as Job<ReceiptJob>);
      default:
        throw new Error(`Unknown job "${(job as Job).name}" in queue "${QUEUES.PDF}"`);
    }
  }

  private async qrSheet(job: Job<QrSheetJob>): Promise<{ key: string }> {
    const pdf = await renderQrSheet(job.data);
    await this.storage.put(job.data.outputKey, pdf, "application/pdf");
    this.realtime
      .toRestaurant(job.data.restaurantId)
      .emit("qr-sheet.ready", { restaurantId: job.data.restaurantId, jobId: String(job.id) });
    this.logger.info({ jobId: job.id, tables: job.data.tables.length, bytes: pdf.length }, "qr sheet generated");
    return { key: job.data.outputKey };
  }

  private async receipt(job: Job<ReceiptJob>): Promise<{ key: string }> {
    const { receipt, email, orderId, restaurantId, outputKey } = job.data;
    const pdf = await renderReceipt(receipt);
    await this.storage.put(outputKey, pdf, "application/pdf");

    if (email) {
      await this.emailQueue.add(
        "order-confirmation",
        {
          template: "order-confirmation",
          data: {
            to: email.to,
            channel: receipt.channel === "delivery" ? "delivery" : "pickup",
            customerName: receipt.customerName,
            restaurantName: receipt.restaurant.name,
            restaurantPhone: formatPhone(receipt.restaurant.phone),
            ticketNumber: receipt.ticketNumber,
            readyAt: receipt.estimatedReadyAt ? formatTime(receipt.estimatedReadyAt, receipt.timezone) : null,
            total: formatMoney(receipt.total, receipt.currency),
            trackingUrl: email.trackingUrl,
            attachment: { key: outputKey, filename: `comprobante-pedido-${receipt.number}.pdf` },
          },
        },
        {
          jobId: `order-confirmation-${orderId}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 10_000 },
          removeOnComplete: { age: 3600 },
          removeOnFail: false,
        },
      );
    }

    this.realtime.toRestaurantAndOrder(restaurantId, orderId).emit("order.receipt-ready", { orderId });
    // No customer data in the logs: ids and sizes only.
    this.logger.info({ jobId: job.id, orderId, bytes: pdf.length, emailed: email !== null }, "receipt generated");
    return { key: outputKey };
  }
}
