import { QUEUES } from "@app/types";
import { BullModule } from "@nestjs/bullmq";
import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "../../config/env.validation";
import { EmailQueue } from "./email.queue";
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
    BullModule.registerQueue({ name: QUEUES.EMAIL }, { name: QUEUES.PDF }),
  ],
  providers: [EmailQueue, PdfQueue],
  exports: [EmailQueue, PdfQueue],
})
export class QueueModule {}
