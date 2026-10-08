import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport } from "nodemailer";
import type { WorkersEnv } from "../config/env.validation";
import type { RenderedEmail } from "./templates";

/** SMTP delivery through a pooled connection, reused across jobs. */
@Injectable()
export class MailerService implements OnApplicationShutdown {
  private readonly transport: ReturnType<typeof createTransport>;
  private readonly from: string;

  constructor(config: ConfigService<WorkersEnv, true>) {
    const user = config.get("SMTP_USER", { infer: true });
    const pass = config.get("SMTP_PASS", { infer: true });
    this.from = config.get("MAIL_FROM", { infer: true });
    this.transport = createTransport({
      pool: true,
      host: config.get("SMTP_HOST", { infer: true }),
      port: config.get("SMTP_PORT", { infer: true }),
      secure: config.get("SMTP_SECURE", { infer: true }),
      auth: user && pass ? { user, pass } : undefined,
    });
  }

  /**
   * @param attachments Already loaded files (the processor reads them from storage).
   * @returns The SMTP message id. Throws on delivery failure so BullMQ retries the job.
   */
  async send(
    to: string,
    email: Omit<RenderedEmail, "attachments">,
    attachments: { filename: string; content: Buffer; contentType: string }[] = [],
  ): Promise<string> {
    const info = await this.transport.sendMail({ from: this.from, to, ...email, attachments });
    return String(info.messageId);
  }

  onApplicationShutdown(): void {
    this.transport.close();
  }
}
