import { QUEUES, type QrSheetJob } from "@app/types";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { PrivateStorageService } from "../storage/private-storage.service";
import { renderQrSheet } from "./qr-sheet";

/**
 * Generates PDFs and stores them in the private bucket. Idempotent: a retry overwrites the same key.
 * The owner's screen is notified through Socket.IO (`qr-sheet.ready`) instead of polling.
 */
@Processor(QUEUES.PDF, { concurrency: 2 })
export class PdfProcessor extends WorkerHost {
  constructor(
    private readonly storage: PrivateStorageService,
    private readonly realtime: RealtimeEmitterService,
    @InjectPinoLogger(PdfProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async process(job: Job<QrSheetJob>): Promise<{ key: string }> {
    if (job.name !== "qr-sheet") throw new Error(`Unknown job "${job.name}" in queue "${QUEUES.PDF}"`);

    const pdf = await renderQrSheet(job.data);
    await this.storage.put(job.data.outputKey, pdf, "application/pdf");
    this.realtime
      .toRestaurant(job.data.restaurantId)
      .emit("qr-sheet.ready", { restaurantId: job.data.restaurantId, jobId: String(job.id) });
    this.logger.info({ jobId: job.id, tables: job.data.tables.length, bytes: pdf.length }, "qr sheet generated");
    return { key: job.data.outputKey };
  }
}
