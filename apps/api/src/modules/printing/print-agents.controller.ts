import type {
  PairingCodeView,
  PairPrintAgentResult,
  PrintAgentsList,
  PrintAgentsSummary,
  PrintAgentView,
  PrintJobView,
} from "@app/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { apiError } from "../../common/errors/api-error";
import { Public } from "../auth/decorators";
import {
  CurrentTenant,
  RestaurantAccessGuard,
  RestaurantRoles,
  type TenantContext,
} from "../restaurants/restaurant-access.guard";
import { PairPrintAgentDto, PrintJobsQueryDto, RenamePrintAgentDto, UpdatePrinterDto } from "./dto/printing.dto";
import { PrintAgentsService } from "./print-agents.service";
import { PrintJobsService } from "./print-jobs.service";

/**
 * The owner's "Impresoras": pairing codes, paired computers and their printers. The board's members read the
 * summary (to avoid printing twice from the browser); owner and cashier see and retry failed jobs.
 * `:printerKey` is the agent's key URL-encoded ("usb%3AEPSON%20TM-T20").
 */
@Controller("restaurants/:restaurantId/print-agents")
@UseGuards(RestaurantAccessGuard)
@RestaurantRoles("owner")
export class PrintAgentsController {
  constructor(
    private readonly agents: PrintAgentsService,
    private readonly jobs: PrintJobsService,
  ) {}

  @Post("pairing-code")
  pairingCode(@CurrentTenant() tenant: TenantContext): Promise<PairingCodeView> {
    return this.agents.createPairingCode(tenant.restaurantId);
  }

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<PrintAgentsList> {
    return this.agents.list(tenant.restaurantId);
  }

  @Get("summary")
  @RestaurantRoles("owner", "cashier", "kitchen", "waiter")
  summary(@CurrentTenant() tenant: TenantContext): Promise<PrintAgentsSummary> {
    return this.agents.summary(tenant.restaurantId);
  }

  @Get("jobs")
  @RestaurantRoles("owner", "cashier")
  listJobs(@CurrentTenant() tenant: TenantContext, @Query() query: PrintJobsQueryDto): Promise<PrintJobView[]> {
    return this.jobs.list(tenant.restaurantId, query.status, query.limit ?? 20);
  }

  @Post("jobs/:jobId/retry")
  @RestaurantRoles("owner", "cashier")
  @HttpCode(HttpStatus.OK)
  retry(@CurrentTenant() tenant: TenantContext, @Param("jobId") jobId: string): Promise<PrintJobView> {
    return this.jobs.retry(tenant.restaurantId, jobId);
  }

  @Patch(":agentId")
  rename(
    @CurrentTenant() tenant: TenantContext,
    @Param("agentId") agentId: string,
    @Body() dto: RenamePrintAgentDto,
  ): Promise<PrintAgentView> {
    return this.agents.rename(tenant.restaurantId, agentId, dto.name);
  }

  @Patch(":agentId/printers/:printerKey")
  updatePrinter(
    @CurrentTenant() tenant: TenantContext,
    @Param("agentId") agentId: string,
    @Param("printerKey") printerKey: string,
    @Body() dto: UpdatePrinterDto,
  ): Promise<PrintAgentView> {
    return this.agents.updatePrinter(tenant.restaurantId, agentId, printerKey, dto);
  }

  /** Removes a printer that no longer exists (it comes back disabled if the agent reports it again). */
  @Delete(":agentId/printers/:printerKey")
  removePrinter(
    @CurrentTenant() tenant: TenantContext,
    @Param("agentId") agentId: string,
    @Param("printerKey") printerKey: string,
  ): Promise<PrintAgentView> {
    return this.agents.removePrinter(tenant.restaurantId, agentId, printerKey);
  }

  /** A test page (enabled or not). */
  @Post(":agentId/printers/:printerKey/test")
  async test(
    @CurrentTenant() tenant: TenantContext,
    @Param("agentId") agentId: string,
    @Param("printerKey") printerKey: string,
  ): Promise<PrintJobView> {
    const job = await this.agents.testPrinter(tenant.restaurantId, agentId, printerKey);
    // Only if two identical requests landed in the same millisecond.
    if (!job) throw new NotFoundException(apiError("PRINT_JOB_NOT_FOUND", "No se pudo crear la prueba; inténtalo de nuevo"));
    return job;
  }

  @Delete(":agentId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@CurrentTenant() tenant: TenantContext, @Param("agentId") agentId: string): Promise<void> {
    await this.agents.revoke(tenant.restaurantId, agentId);
  }
}

/** Pairing, called by the agent itself (no session: the one-time code is the credential). */
@Controller("print-agents")
export class PublicPrintAgentsController {
  constructor(private readonly agents: PrintAgentsService) {}

  /**
   * Redeems a pairing code for the agent's device token. Rate-limited like login: the code space is large
   * but finite, and codes live 10 minutes.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("pair")
  pair(@Body() dto: PairPrintAgentDto): Promise<PairPrintAgentResult> {
    return this.agents.pair(dto);
  }
}
