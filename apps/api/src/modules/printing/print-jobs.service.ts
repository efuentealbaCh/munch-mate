import {
  type AgentAck,
  type AgentPrinter,
  type OrderView,
  type PaymentMethod,
  PRINT_LIMITS,
  type PrintJobKind,
  type PrintJobPayload,
  type PrintJobStatus,
  type PrintJobView,
} from "@app/types";
import {
  kitchenTicket,
  layoutTicket,
  paymentReceiptTicket,
  type TablePaymentReceiptInput,
  type Ticket,
  testTicket,
  ticketColumns,
} from "@app/utils";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { apiError } from "../../common/errors/api-error";
import { CategoriesRepository } from "../menu/categories.repository";
import { ProductsRepository } from "../menu/products.repository";
import { RealtimeService } from "../realtime/realtime.service";
import { type RestaurantRecord, RestaurantsRepository } from "../restaurants/restaurants.repository";
import { type PrintAgentRecord, PrintAgentsRepository } from "./print-agents.repository";
import { PrintAgentsRealtime } from "./print-agents.realtime";
import { type PrintJobRecord, PrintJobsRepository } from "./print-jobs.repository";

/** A printer of a paired agent that a job goes to. */
interface Target {
  agent: PrintAgentRecord;
  printer: AgentPrinter;
}

/** What every job of one event shares. */
interface JobEvent {
  kind: PrintJobKind;
  label: string;
  /** Deterministic per event; the agent and the printer are appended (`<base>:<agentId>:<printerKey>`). */
  dedupeBase: string;
  orderId?: string;
  orderRevision?: number;
  tableSessionId?: string;
  paymentId?: string;
}

/** A table payment to print, without the restaurant's own data (looked up here). */
export type TablePaymentReceipt = Omit<TablePaymentReceiptInput, "restaurantName" | "timeZone" | "currency" | "kind"> & {
  sessionId: string;
  paymentId: string;
};

const EXPIRED_KITCHEN = "Venció sin imprimirse (la comanda tenía más de 30 minutos)";
const EXPIRED_RECEIPT = "Venció sin imprimirse";
const PRINTER_DISABLED = "La impresora está desactivada, no está conectada al computador o se quitó";
const jobNotFound = () => new NotFoundException(apiError("PRINT_JOB_NOT_FOUND", "No encontramos ese trabajo de impresión"));

/**
 * Print jobs of the local print agents (phase 8): turns order and payment events into tickets for the printers
 * whose rules ask for them, sends them to the agents and tracks what they report.
 *
 * Event hooks (`orderCreated`, `orderAccepted`, `orderEdited`, `orderPaid`, `tablePayment`) never fail the
 * caller: errors are logged and the browser printing remains as a fallback. Without agents nothing happens.
 */
@Injectable()
export class PrintJobsService {
  constructor(
    private readonly jobs: PrintJobsRepository,
    private readonly agents: PrintAgentsRepository,
    private readonly agentsRealtime: PrintAgentsRealtime,
    private readonly realtime: RealtimeService,
    private readonly restaurants: RestaurantsRepository,
    private readonly products: ProductsRepository,
    private readonly categories: CategoriesRepository,
    @InjectPinoLogger(PrintJobsService.name) private readonly logger: PinoLogger,
  ) {}

  // ── Order and payment events ────────────────────────────────────────────

  /** A new order: kitchen tickets on the printers with the rule "new". */
  async orderCreated(restaurantId: string, order: OrderView): Promise<void> {
    await this.safely(restaurantId, order.id, () => this.kitchen(restaurantId, order, (p) => p.kitchen === "new"));
  }

  /** The staff accepted an order: kitchen tickets on the printers with the rule "accepted". */
  async orderAccepted(restaurantId: string, order: OrderView): Promise<void> {
    await this.safely(restaurantId, order.id, () => this.kitchen(restaurantId, order, (p) => p.kitchen === "accepted"));
  }

  /**
   * The staff edited the items: a "MODIFICADO" ticket, only on the printers that already printed a kitchen
   * ticket of the order or still have one queued (the others never told the kitchen about it). Printed even
   * when none of the printer's categories is left: the kitchen must learn that its items were removed.
   */
  async orderEdited(restaurantId: string, order: OrderView): Promise<void> {
    await this.safely(restaurantId, order.id, async () => {
      const holders = await this.jobs.printersWithKitchenTicket(restaurantId, order.id);
      if (holders.length === 0) return;
      const held = new Set(holders.map((ref) => `${ref.agentId}|${ref.printerKey}`));
      await this.kitchen(
        restaurantId,
        order,
        (printer, agent) => printer.kitchen !== "off" && held.has(`${agent.id}|${printer.key}`),
        { edited: true },
      );
    });
  }

  /** A pickup, delivery or table order paid on its own (`markPaid`): one receipt per receipt printer. */
  async orderPaid(restaurantId: string, order: OrderView, method: PaymentMethod, byName: string | null): Promise<void> {
    await this.safely(restaurantId, order.id, async () => {
      const targets = await this.targets(restaurantId, (p) => p.receipts);
      if (targets.length === 0) return;
      const restaurant = await this.restaurant(restaurantId);
      const ticket = paymentReceiptTicket({
        kind: "order",
        restaurantName: restaurant.name,
        timeZone: restaurant.timezone,
        currency: order.currency,
        at: new Date(),
        byName,
        method,
        order,
      });
      await this.queue(
        restaurantId,
        targets,
        () => ticket,
        { kind: "receipt", label: `Comprobante #${order.ticketNumber}`, dedupeBase: `receipt:order:${order.id}`, orderId: order.id },
      );
    });
  }

  /** A payment of a table account (partial, or the one that closes it): one receipt per receipt printer. */
  async tablePayment(restaurantId: string, receipt: TablePaymentReceipt): Promise<void> {
    await this.safely(restaurantId, receipt.paymentId, async () => {
      const targets = await this.targets(restaurantId, (p) => p.receipts);
      if (targets.length === 0) return;
      const restaurant = await this.restaurant(restaurantId);
      const { sessionId, paymentId, ...rest } = receipt;
      const ticket = paymentReceiptTicket({
        ...rest,
        kind: "table",
        restaurantName: restaurant.name,
        timeZone: restaurant.timezone,
        currency: restaurant.currency,
      });
      await this.queue(restaurantId, targets, () => ticket, {
        kind: "receipt",
        label: `Comprobante ${receipt.tableLabel}`,
        dedupeBase: `receipt:${paymentId}`,
        tableSessionId: sessionId,
        paymentId,
      });
    });
  }

  /**
   * "Imprimir" on the board: the kitchen ticket again on every printer that prints kitchen tickets (rule
   * other than "off"), on purpose, so each request is a new event. Errors reach the caller.
   * @returns Jobs queued (0: no kitchen printer active, or none of their categories in the order).
   */
  async printOrder(restaurantId: string, order: OrderView): Promise<number> {
    return this.kitchen(restaurantId, order, (p) => p.kitchen !== "off", { manual: true });
  }

  /** A test page on one printer (enabled or not: the owner checks it before turning it on). */
  async testPrinter(restaurantId: string, agent: PrintAgentRecord, printer: AgentPrinter): Promise<PrintJobView | null> {
    const restaurant = await this.restaurant(restaurantId);
    const [job] = await this.queueJobs(
      restaurantId,
      [{ agent, printer }],
      () => testTicket(restaurant.name, printer.name, printer.paper, new Date(), restaurant.timezone),
      { kind: "test", label: "Página de prueba", dedupeBase: `test:${Date.now()}` },
    );
    return job ? toView(job, new Map([[agent.id, agent]])) : null;
  }

  // ── Agents ──────────────────────────────────────────────────────────────

  /**
   * After an agent says hello: expires what is too old to print, drops jobs of printers no longer enabled,
   * and sends the rest again (the agent deduplicates by job id).
   */
  async resendPending(agent: PrintAgentRecord): Promise<void> {
    const now = Date.now();
    const kitchenCutoff = new Date(now - PRINT_LIMITS.kitchenExpireMinutes * 60_000);
    const receiptCutoff = new Date(now - PRINT_LIMITS.receiptExpireHours * 3_600_000);
    const expiredKitchen = await this.jobs.expireStale(
      agent.restaurantId,
      agent.id,
      { kitchen: kitchenCutoff, receipt: new Date(0) },
      EXPIRED_KITCHEN,
    );
    const expiredReceipts = await this.jobs.expireStale(
      agent.restaurantId,
      agent.id,
      { kitchen: new Date(0), receipt: receiptCutoff },
      EXPIRED_RECEIPT,
    );
    const agentsById = new Map([[agent.id, agent]]);
    for (const job of [...expiredKitchen, ...expiredReceipts]) this.announceFailure(job, agentsById);

    const pending = await this.jobs.listPending(agent.restaurantId, agent.id, PRINT_LIMITS.resendMax);
    const reported = new Set(agent.printers.filter((p) => p.reported).map((p) => p.key));
    const usable = new Set(agent.printers.filter((p) => p.enabled && p.reported).map((p) => p.key));
    // Test pages go to disabled printers too (the owner tests before enabling), but only to reported ones.
    const dropped = pending.filter((job) => !(job.kind === "test" ? reported : usable).has(job.printerKey));
    await this.jobs.expire(agent.restaurantId, dropped.map((job) => job.id), PRINTER_DISABLED);
    for (const job of pending) {
      if (!dropped.includes(job)) await this.send(job);
    }
  }

  /**
   * `print.result` of an agent. A duplicate confirmation of a printed job answers ok too.
   * @returns The ack: JOB_NOT_FOUND when the job is not this agent's.
   */
  async handleResult(
    agent: Pick<PrintAgentRecord, "id" | "restaurantId">,
    result: { jobId: string; ok: true } | { jobId: string; ok: false; error: string },
  ): Promise<AgentAck> {
    const updated = await this.jobs.setResult(
      agent.restaurantId,
      agent.id,
      result.jobId,
      result.ok ? { ok: true } : { ok: false, error: result.error },
    );
    if (!updated) {
      const job = await this.jobs.findOne(agent.restaurantId, result.jobId);
      return job && job.agentId === agent.id ? { ok: true } : { ok: false, code: "JOB_NOT_FOUND" };
    }
    if (updated.status === "failed") {
      const agents = await this.agents.listActive(agent.restaurantId);
      this.announceFailure(updated, new Map(agents.map((a) => [a.id, a])));
    }
    return { ok: true };
  }

  // ── Staff ───────────────────────────────────────────────────────────────

  /** Latest jobs (failed ones by default for the web), newest first. */
  async list(restaurantId: string, status: PrintJobStatus | undefined, limit: number): Promise<PrintJobView[]> {
    const [jobs, agents] = await Promise.all([
      this.jobs.list(restaurantId, status, Math.min(limit, PRINT_LIMITS.jobsListMax)),
      this.agents.listActive(restaurantId),
    ]);
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    return jobs.map((job) => toView(job, agentsById));
  }

  /**
   * Queues a failed or expired job again, as it was laid out.
   * @throws NotFoundException PRINT_JOB_NOT_FOUND; ConflictException PRINT_AGENT_REVOKED, PRINT_JOB_NOT_RETRYABLE.
   */
  async retry(restaurantId: string, jobId: string): Promise<PrintJobView> {
    const job = await this.jobs.findOne(restaurantId, jobId);
    if (!job) throw jobNotFound();
    const agent = await this.agents.findActive(restaurantId, job.agentId);
    if (!agent) {
      throw new ConflictException(apiError("PRINT_AGENT_REVOKED", "Ese computador ya no está vinculado; imprime desde el navegador"));
    }
    const requeued = await this.jobs.requeue(restaurantId, jobId);
    if (!requeued) {
      throw new ConflictException(apiError("PRINT_JOB_NOT_RETRYABLE", "Ese trabajo ya se imprimió o sigue en la cola"));
    }
    await this.send(requeued);
    return toView({ ...requeued, status: "sent", attempts: requeued.attempts + 1 }, new Map([[agent.id, agent]]));
  }

  /** Expires every pending job of an unpaired agent. */
  async dropAgent(restaurantId: string, agentId: string): Promise<void> {
    await this.jobs.expireAllOf(restaurantId, agentId, "El computador se desvinculó");
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  /**
   * Kitchen tickets of an order on the printers `pick` chooses, each with only its categories. Printers left
   * with no item get no ticket, except for edits.
   */
  private async kitchen(
    restaurantId: string,
    order: OrderView,
    pick: (printer: AgentPrinter, agent: PrintAgentRecord) => boolean,
    options: { edited?: boolean; manual?: boolean } = {},
  ): Promise<number> {
    const targets = await this.targets(restaurantId, pick);
    if (targets.length === 0) return 0;
    const restaurant = await this.restaurant(restaurantId);
    const filtered = targets.some((t) => t.printer.categoryIds.length > 0);
    const [products, categories] = filtered
      ? await Promise.all([this.products.list(restaurantId), this.categories.list(restaurantId)])
      : [[], []];
    const productCategory = filtered ? new Map(products.map((p) => [p.id, p.categoryId])) : undefined;
    const existing = new Set(categories.map((c) => c.id));
    // A filter whose categories were all deleted from the menu would silence the printer for good: it prints
    // everything again until the owner picks new categories.
    const categoriesOf = (printer: AgentPrinter) => {
      const kept = printer.categoryIds.filter((id) => existing.has(id));
      return kept.length > 0 ? new Set(kept) : undefined;
    };
    const kind: PrintJobKind = options.edited ? "kitchen_edited" : "kitchen";
    const dedupeBase = options.edited
      ? `kitchen:${order.id}:r${order.revision}`
      : options.manual
        ? `kitchen:${order.id}:m${Date.now()}`
        : `kitchen:${order.id}`;
    const jobs = await this.queueJobs(
      restaurantId,
      targets,
      (printer) => {
        const ticket = kitchenTicket(order, restaurant.name, restaurant.timezone, {
          categoryIds: categoriesOf(printer),
          productCategory,
        });
        return ticket.lines.length > 0 || options.edited ? ticket : null;
      },
      {
        kind,
        label: `${options.edited ? "Comanda modificada" : "Comanda"} #${order.ticketNumber}`,
        dedupeBase,
        orderId: order.id,
        orderRevision: order.revision,
      },
    );
    return jobs.length;
  }

  /**
   * Enabled printers that their agent still reports (unreported ones count as disabled for routing, without
   * changing `enabled`), of the restaurant's paired agents, that `pick` chooses.
   */
  private async targets(
    restaurantId: string,
    pick: (printer: AgentPrinter, agent: PrintAgentRecord) => boolean,
  ): Promise<Target[]> {
    const agents = await this.agents.listActive(restaurantId);
    return agents.flatMap((agent) =>
      agent.printers.filter((printer) => printer.enabled && printer.reported && pick(printer, agent)).map((printer) => ({ agent, printer })),
    );
  }

  private async queue(restaurantId: string, targets: Target[], build: (printer: AgentPrinter) => Ticket | null, event: JobEvent) {
    await this.queueJobs(restaurantId, targets, build, event);
  }

  /**
   * Lays the ticket out for each printer's paper, stores the job (skipped when its dedupe key exists: the
   * same event again) and sends it.
   * @returns The jobs created now.
   */
  private async queueJobs(
    restaurantId: string,
    targets: Target[],
    build: (printer: AgentPrinter) => Ticket | null,
    event: JobEvent,
  ): Promise<PrintJobRecord[]> {
    const created: PrintJobRecord[] = [];
    for (const { agent, printer } of targets) {
      const ticket = build(printer);
      if (!ticket) continue;
      const job = await this.jobs.insert(restaurantId, {
        agentId: agent.id,
        printerKey: printer.key,
        kind: event.kind,
        label: event.label,
        dedupeKey: `${event.dedupeBase}:${agent.id}:${printer.key}`,
        orderId: event.orderId ?? null,
        orderRevision: event.orderRevision ?? null,
        tableSessionId: event.tableSessionId ?? null,
        paymentId: event.paymentId ?? null,
        lines: layoutTicket(ticket, ticketColumns(printer.paper)).lines,
        paper: printer.paper,
        // Extra copies are for kitchen tickets (one for the cook, one for the pass); receipts and tests print once.
        copies: event.kind === "kitchen" || event.kind === "kitchen_edited" ? printer.copies : 1,
      });
      if (!job) continue;
      await this.send(job);
      created.push(job);
    }
    return created;
  }

  /** Emits the job to its agent's room (dropped if it is offline: it is re-sent when it connects). */
  private async send(job: PrintJobRecord): Promise<void> {
    this.agentsRealtime.toAgent(job.agentId).emit("print.job", toPayload(job));
    await this.jobs.markSent(job.restaurantId, job.id);
  }

  /** Tells the staff a job did not print (the web offers to retry it or print from the browser). */
  private announceFailure(job: PrintJobRecord, agentsById: Map<string, PrintAgentRecord>): void {
    this.realtime.toRestaurant(job.restaurantId).emit("print.job-failed", toView(job, agentsById));
  }

  private async restaurant(restaurantId: string): Promise<RestaurantRecord> {
    const restaurant = await this.restaurants.findById(restaurantId);
    if (!restaurant) throw new NotFoundException(apiError("RESTAURANT_NOT_FOUND", "Restaurante no encontrado"));
    return restaurant;
  }

  private async safely(restaurantId: string, subjectId: string, work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.warn({ restaurantId, subjectId, err: error }, "print job skipped");
    }
  }
}

/** What the agent receives. */
export function toPayload(job: PrintJobRecord): PrintJobPayload {
  return {
    jobId: job.id,
    printerKey: job.printerKey,
    paper: job.paper,
    copies: job.copies,
    kind: job.kind,
    layout: { columns: ticketColumns(job.paper), lines: job.lines, cut: true },
    queuedAt: job.queuedAt.toISOString(),
  };
}

function toView(job: PrintJobRecord, agentsById: Map<string, PrintAgentRecord>): PrintJobView {
  const agent = agentsById.get(job.agentId);
  return {
    id: job.id,
    agentId: job.agentId,
    agentName: agent?.name ?? "Computador desvinculado",
    printerKey: job.printerKey,
    printerName: agent?.printers.find((p) => p.key === job.printerKey)?.name ?? "",
    kind: job.kind,
    label: job.label,
    orderId: job.orderId,
    status: job.status,
    attempts: job.attempts,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    printedAt: job.printedAt?.toISOString() ?? null,
  };
}
