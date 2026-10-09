import { QUEUES } from "@app/types";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { NotifProcessor } from "./notif.processor";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.NOTIF })],
  providers: [NotifProcessor],
})
export class NotifModule {}
