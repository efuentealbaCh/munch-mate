import { Module } from "@nestjs/common";
import { MessagingService } from "./messaging.service";

/** WhatsApp/SMS order notices; the queue producers come from the global QueueModule. */
@Module({
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
