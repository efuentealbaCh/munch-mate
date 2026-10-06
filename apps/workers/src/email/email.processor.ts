import { type EmailJob, QUEUES } from "@app/types";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import type { Job } from "bullmq";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { MailerService } from "./mailer.service";
import { renderEmail } from "./templates";

/**
 * Sends the emails enqueued by the api. Retries and backoff are set by the producer.
 * Not strictly idempotent: if SMTP accepts the message but the job fails afterwards, a retry sends it again.
 * For transactional emails a rare duplicate is preferable to a lost one.
 */
@Processor(QUEUES.EMAIL, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  constructor(
    private readonly mailer: MailerService,
    @InjectPinoLogger(EmailProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<{ messageId: string }> {
    const messageId = await this.mailer.send(job.data.data.to, renderEmail(job.data));
    // Never log job.data: it contains one-time links.
    this.logger.info({ jobId: job.id, template: job.data.template, messageId }, "email sent");
    return { messageId };
  }
}
