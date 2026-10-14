import type { MessageJob } from "@app/types";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectConnection } from "@nestjs/mongoose";
import { UnrecoverableError } from "bullmq";
import type { Connection } from "mongoose";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import type { WorkersEnv } from "../config/env.validation";
import { MailerService } from "../email/mailer.service";

export interface MessageResult {
  status: "sent" | "already_sent" | "skipped";
  /** Provider message id (Twilio SID, or the Mailpit email id). */
  providerId?: string;
}

/** Provider answers that will never succeed on retry (bad number, bad credentials, unknown sender). */
const PERMANENT = new Set([400, 401, 403, 404]);

/**
 * Sends WhatsApp/SMS notices (phase 8) through the configured provider:
 * - `twilio`: Twilio's Messages API, one account for both channels (WhatsApp numbers get the `whatsapp:`
 *   prefix). The sender must be a number of that account (for WhatsApp, an approved business sender).
 * - `mailpit`: local stacks only; each message becomes an email to `<digits>@<channel>.mensajes.local`.
 * Idempotent: a job that already sent its message (recorded by job id in `sent_messages`, without the phone or
 * the text) is not sent again when BullMQ retries it.
 */
@Injectable()
export class MessageSenderService {
  private readonly provider: WorkersEnv["MESSAGING_PROVIDER"];
  private readonly twilio: { sid: string; token: string; apiUrl: string } | null;

  constructor(
    config: ConfigService<WorkersEnv, true>,
    private readonly mailer: MailerService,
    @InjectConnection() private readonly connection: Connection,
    @InjectPinoLogger(MessageSenderService.name) private readonly logger: PinoLogger,
  ) {
    this.provider = config.get("MESSAGING_PROVIDER", { infer: true });
    const sid = config.get("TWILIO_ACCOUNT_SID", { infer: true });
    const token = config.get("TWILIO_AUTH_TOKEN", { infer: true });
    this.twilio = sid && token ? { sid, token, apiUrl: config.get("TWILIO_API_URL", { infer: true }) } : null;
  }

  async send(jobId: string, message: MessageJob): Promise<MessageResult> {
    if (this.provider === "off") {
      this.logger.warn({ jobId }, "message skipped: no messaging provider configured in the workers");
      return { status: "skipped" };
    }
    const log = this.connection.collection<{ _id: string; providerId: string; sentAt: Date }>("sent_messages");
    if (await log.findOne({ _id: jobId })) return { status: "already_sent" };

    const providerId = this.provider === "twilio" ? await this.sendWithTwilio(message) : await this.sendToMailpit(message);
    await log.updateOne({ _id: jobId }, { $setOnInsert: { providerId, sentAt: new Date() } }, { upsert: true });
    // Never log the phone numbers or the text.
    this.logger.info({ jobId, channel: message.channel, event: message.event }, "order message sent");
    return { status: "sent", providerId };
  }

  private async sendWithTwilio(message: MessageJob): Promise<string> {
    if (!this.twilio) throw new UnrecoverableError("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not configured");
    const prefix = message.channel === "whatsapp" ? "whatsapp:" : "";
    const response = await fetch(`${this.twilio.apiUrl}/2010-04-01/Accounts/${this.twilio.sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.twilio.sid}:${this.twilio.token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: `${prefix}${message.from}`, To: `${prefix}${message.to}`, Body: message.text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (response.ok && body.sid) return body.sid;
    const detail = `Twilio ${response.status}${body.code ? ` (${body.code})` : ""}: ${body.message ?? "sin detalle"}`;
    // A wrong number or sender will fail the same way every time: keep the job failed for inspection, no retries.
    if (PERMANENT.has(response.status)) throw new UnrecoverableError(detail);
    throw new Error(detail);
  }

  private async sendToMailpit(message: MessageJob): Promise<string> {
    const digits = message.to.replace(/\D/g, "");
    const label = message.channel === "whatsapp" ? "WhatsApp" : "SMS";
    return this.mailer.send(`${digits}@${message.channel}.mensajes.local`, {
      subject: `[${label}] de ${message.from} para ${message.to}`,
      text: message.text,
      html: `<p>${escapeHtml(message.text)}</p>`,
    });
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
