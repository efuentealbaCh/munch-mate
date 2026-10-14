import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { MenuModule } from "../menu/menu.module";
import { RestaurantsModule } from "../restaurants/restaurants.module";
import { PrintAgentPresence } from "./print-agent-presence";
import { PrintAgentsController, PublicPrintAgentsController } from "./print-agents.controller";
import { PrintAgentsGateway } from "./print-agents.gateway";
import { PrintAgentsRealtime } from "./print-agents.realtime";
import { PrintAgentsRepository } from "./print-agents.repository";
import { PrintAgentsService } from "./print-agents.service";
import { PrintJobsRepository } from "./print-jobs.repository";
import { PrintJobsService } from "./print-jobs.service";
import { PrintAgent, PrintAgentSchema } from "./schemas/print-agent.schema";
import { PrintJob, PrintJobSchema } from "./schemas/print-job.schema";

/**
 * Direct ESC/POS printing through local print agents (phase 8): pairing, printer settings, the agents'
 * Socket.IO namespace and the print jobs the orders module queues.
 */
@Module({
  imports: [
    RestaurantsModule,
    MenuModule,
    MongooseModule.forFeature([
      { name: PrintAgent.name, schema: PrintAgentSchema },
      { name: PrintJob.name, schema: PrintJobSchema },
    ]),
  ],
  controllers: [PrintAgentsController, PublicPrintAgentsController],
  providers: [
    PrintAgentsService,
    PrintJobsService,
    PrintAgentsRepository,
    PrintJobsRepository,
    PrintAgentPresence,
    PrintAgentsRealtime,
    PrintAgentsGateway,
  ],
  // The orders module queues kitchen tickets and receipts.
  exports: [PrintJobsService],
})
export class PrintingModule {}
