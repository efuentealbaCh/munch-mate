import { type NotifJob, QUEUES } from "@app/types";
import { isPushEndpointAllowed } from "@app/utils";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { InjectConnection } from "@nestjs/mongoose";
import type { Job } from "bullmq";
import type { Connection } from "mongoose";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import webpush, { WebPushError } from "web-push";
import type { WorkersEnv } from "../config/env.validation";

/** The push service says the browser unsubscribed or the subscription expired: forget it. */
const GONE = new Set([404, 410]);
/** A notification older than this is not worth showing (the board and tracking page have the truth). */
const TTL_SECONDS = 60 * 60;

export interface NotifResult {
  sent: number;
  removed: number;
  skipped?: "not_configured";
}

/**
 * Sends web-push notifications. Subscriptions reported gone are deleted from MongoDB (by endpoint, without
 * a schema: the api owns the collection). Endpoints outside the known push services are never called (SSRF).
 * A retry may re-send to some browsers; notifications carry a tag, so the browser replaces instead of
 * stacking them.
 */
@Processor(QUEUES.NOTIF, { concurrency: 5 })
export class NotifProcessor extends WorkerHost {
  private readonly vapid: { subject: string; publicKey: string; privateKey: string } | null;

  constructor(
    config: ConfigService<WorkersEnv, true>,
    @InjectConnection() private readonly connection: Connection,
    @InjectPinoLogger(NotifProcessor.name) private readonly logger: PinoLogger,
  ) {
    super();
    const publicKey = config.get("VAPID_PUBLIC_KEY", { infer: true });
    const privateKey = config.get("VAPID_PRIVATE_KEY", { infer: true });
    const subject = config.get("VAPID_SUBJECT", { infer: true }) ?? "mailto:soporte@munchmate.local";
    this.vapid = publicKey && privateKey ? { subject, publicKey, privateKey } : null;
  }

  async process(job: Job<NotifJob>): Promise<NotifResult> {
    if (job.name !== "push") throw new Error(`Unknown job "${job.name}" in queue "${QUEUES.NOTIF}"`);
    if (!this.vapid) {
      this.logger.warn({ jobId: job.id }, "push skipped: VAPID keys are not configured in the workers");
      return { sent: 0, removed: 0, skipped: "not_configured" };
    }

    const payload = JSON.stringify(job.data.notification);
    let sent = 0;
    let removed = 0;
    const failures: unknown[] = [];
    for (const subscription of job.data.subscriptions) {
      if (!isPushEndpointAllowed(subscription.endpoint)) continue;
      try {
        await webpush.sendNotification(subscription, payload, {
          TTL: TTL_SECONDS,
          urgency: "high",
          vapidDetails: this.vapid,
        });
        sent++;
      } catch (error) {
        if (error instanceof WebPushError && GONE.has(error.statusCode)) {
          await this.connection.collection("push_subscriptions").deleteOne({ endpoint: subscription.endpoint });
          removed++;
        } else {
          failures.push(error);
        }
      }
    }

    // Never log the endpoints or the payload: they identify people's browsers.
    this.logger.info({ jobId: job.id, sent, removed, failed: failures.length }, "push notifications sent");
    if (failures.length > 0) throw new Error(`${failures.length} push notification(s) failed; retrying`);
    return { sent, removed };
  }
}
