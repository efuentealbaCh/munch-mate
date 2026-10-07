import { QUEUES } from "@app/types";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { PrivateStorageService } from "../storage/private-storage.service";
import { PdfProcessor } from "./pdf.processor";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.PDF })],
  providers: [PdfProcessor, PrivateStorageService, RealtimeEmitterService],
})
export class PdfModule {}
