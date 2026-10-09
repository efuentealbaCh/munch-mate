import { QUEUES } from "@app/types";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { SystemProcessor } from "./system.processor";

@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.SYSTEM })],
  providers: [SystemProcessor],
})
export class SystemModule {}
