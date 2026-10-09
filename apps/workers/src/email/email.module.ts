import { QUEUES } from "@app/types";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { EmailProcessor } from "./email.processor";
import { PrivateStorageService } from "../storage/private-storage.service";
import { MailerService } from "./mailer.service";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.EMAIL })],
  providers: [EmailProcessor, MailerService, PrivateStorageService],
})
export class EmailModule {}
