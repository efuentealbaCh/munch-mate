import { QUEUES } from "@app/types";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { MailerService } from "../email/mailer.service";
import { MessageSenderService } from "./message-sender.service";
import { NotifProcessor } from "./notif.processor";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.NOTIF })],
  providers: [NotifProcessor, MessageSenderService, MailerService],
})
export class NotifModule {}
