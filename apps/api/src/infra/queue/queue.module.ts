import { QUEUES } from "@app/types";
import { BullModule } from "@nestjs/bullmq";
import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "../../config/env.validation";
import { EmailQueue } from "./email.queue";
import { NotifQueue } from "./notif.queue";
import { PdfQueue } from "./pdf.queue";

/** BullMQ producers. The api only enqueues; every processor lives in apps/workers. */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>) => ({
        connection: { url: config.get("VALKEY_URL", { infer: true }) },
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.EMAIL }, { name: QUEUES.PDF }, { name: QUEUES.NOTIF }),
  ],
  providers: [EmailQueue, PdfQueue, NotifQueue],
  exports: [EmailQueue, PdfQueue, NotifQueue],
})
export class QueueModule {}
