import type { PrintJobKind, PrintJobStatus, PrintLine, PrintPaper } from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { PrintJob } from "./schemas/print-job.schema";

export interface PrintJobRecord {
  id: string;
  restaurantId: string;
  agentId: string;
  printerKey: string;
  kind: PrintJobKind;
  label: string;
  dedupeKey: string;
  orderId: string | null;
  orderRevision: number | null;
  tableSessionId: string | null;
  paymentId: string | null;
  lines: PrintLine[];
  paper: PrintPaper;
  copies: number;
  status: PrintJobStatus;
  attempts: number;
  error: string | null;
  queuedAt: Date;
  printedAt: Date | null;
  createdAt: Date;
}

export type NewPrintJob = Pick<
  PrintJobRecord,
  | "agentId"
  | "printerKey"
  | "kind"
  | "label"
  | "dedupeKey"
  | "orderId"
  | "orderRevision"
  | "tableSessionId"
  | "paymentId"
  | "lines"
  | "paper"
  | "copies"
>;

/** A printer that holds (or is about to print) a kitchen ticket of an order. */
export interface PrinterRef {
  agentId: string;
  printerKey: string;
}

const oid = (id: string) => new Types.ObjectId(id);
const optionalOid = (id: string | null) => (id ? oid(id) : null);
const DUPLICATE_KEY = 11000;
/** Jobs the agent has not confirmed yet. */
const PENDING: PrintJobStatus[] = ["queued", "sent"];
/** Kinds that expire after `kitchenExpireMinutes`. */
const SHORT_LIVED: PrintJobKind[] = ["kitchen", "kitchen_edited", "test"];
const KITCHEN_KINDS: PrintJobKind[] = ["kitchen", "kitchen_edited"];

/** Tenant-scoped: every method takes the restaurant id first and filters by it. */
@Injectable()
export class PrintJobsRepository {
  constructor(@InjectModel(PrintJob.name) private readonly jobs: Model<PrintJob>) {}

  /**
   * Queues a job. @returns null when a job with the same `dedupeKey` already exists in the restaurant (the
   * same event seen twice): nothing is printed again.
   */
  async insert(restaurantId: string, job: NewPrintJob): Promise<PrintJobRecord | null> {
    try {
      const doc = await this.jobs.create({
        ...job,
        restaurantId: oid(restaurantId),
        agentId: oid(job.agentId),
        orderId: optionalOid(job.orderId),
        tableSessionId: optionalOid(job.tableSessionId),
        paymentId: optionalOid(job.paymentId),
        status: "queued",
        attempts: 0,
        error: null,
        queuedAt: new Date(),
        printedAt: null,
      });
      return toRecord(doc.toObject());
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return null;
      throw error;
    }
  }

  async findOne(restaurantId: string, jobId: string): Promise<PrintJobRecord | null> {
    if (!Types.ObjectId.isValid(jobId)) return null;
    const doc = await this.jobs.findOne({ _id: oid(jobId), restaurantId: oid(restaurantId) }).lean();
    return doc ? toRecord(doc) : null;
  }

  /** The job was emitted to its agent (again): counts the attempt. Confirmed or expired jobs stay as they are. */
  async markSent(restaurantId: string, jobId: string): Promise<void> {
    await this.jobs.updateOne(
      { _id: oid(jobId), restaurantId: oid(restaurantId), status: { $in: PENDING } },
      { $set: { status: "sent" }, $inc: { attempts: 1 } },
    );
  }

  /**
   * What the agent reported. Only the agent the job belongs to can confirm it; a job already printed stays
   * printed (a duplicate delivery answered again).
   * @returns The updated job, or null when it is not this agent's or was already printed.
   */
  async setResult(
    restaurantId: string,
    agentId: string,
    jobId: string,
    result: { ok: true } | { ok: false; error: string },
  ): Promise<PrintJobRecord | null> {
    if (!Types.ObjectId.isValid(jobId)) return null;
    const doc = await this.jobs
      .findOneAndUpdate(
        { _id: oid(jobId), restaurantId: oid(restaurantId), agentId: oid(agentId), status: { $ne: "printed" } },
        {
          $set: result.ok
            ? { status: "printed", printedAt: new Date(), error: null }
            : { status: "failed", error: result.error },
        },
        { returnDocument: "after" },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  /**
   * Expires the agent's pending jobs queued before the cutoffs: kitchen and test tickets (old orders must not
   * come out of the kitchen printer) and receipts (much longer).
   * @returns The jobs expired now (the staff hear about them).
   */
  async expireStale(
    restaurantId: string,
    agentId: string,
    cutoffs: { kitchen: Date; receipt: Date },
    reason: string,
  ): Promise<PrintJobRecord[]> {
    const filter = {
      restaurantId: oid(restaurantId),
      agentId: oid(agentId),
      status: { $in: PENDING },
      $or: [
        { kind: { $in: SHORT_LIVED }, queuedAt: { $lt: cutoffs.kitchen } },
        { kind: "receipt" as const, queuedAt: { $lt: cutoffs.receipt } },
      ],
    };
    const stale = await this.jobs.find(filter).lean();
    if (stale.length === 0) return [];
    await this.jobs.updateMany(
      { _id: { $in: stale.map((doc) => doc._id) }, status: { $in: PENDING } },
      { $set: { status: "expired", error: reason } },
    );
    return stale.map((doc) => ({ ...toRecord(doc), status: "expired" as const, error: reason }));
  }

  /** Expires specific pending jobs (their printer was disabled, or the agent unpaired). */
  async expire(restaurantId: string, jobIds: string[], reason: string): Promise<void> {
    if (jobIds.length === 0) return;
    await this.jobs.updateMany(
      { _id: { $in: jobIds.map(oid) }, restaurantId: oid(restaurantId), status: { $in: PENDING } },
      { $set: { status: "expired", error: reason } },
    );
  }

  /** Expires every pending job of an agent (unpaired). */
  async expireAllOf(restaurantId: string, agentId: string, reason: string): Promise<void> {
    await this.jobs.updateMany(
      { restaurantId: oid(restaurantId), agentId: oid(agentId), status: { $in: PENDING } },
      { $set: { status: "expired", error: reason } },
    );
  }

  /** The agent's pending jobs, oldest first. */
  async listPending(restaurantId: string, agentId: string, limit: number): Promise<PrintJobRecord[]> {
    const docs = await this.jobs
      .find({ restaurantId: oid(restaurantId), agentId: oid(agentId), status: { $in: PENDING } })
      .sort({ queuedAt: 1, _id: 1 })
      .limit(limit)
      .lean();
    return docs.map(toRecord);
  }

  /** Printers that printed a kitchen ticket of the order, or still have one to print. */
  async printersWithKitchenTicket(restaurantId: string, orderId: string): Promise<PrinterRef[]> {
    if (!Types.ObjectId.isValid(orderId)) return [];
    const docs = await this.jobs
      .find(
        {
          restaurantId: oid(restaurantId),
          orderId: oid(orderId),
          kind: { $in: KITCHEN_KINDS },
          status: { $in: ["queued", "sent", "printed"] as PrintJobStatus[] },
        },
        { agentId: 1, printerKey: 1 },
      )
      .lean();
    const refs = new Map<string, PrinterRef>();
    for (const doc of docs) {
      const ref = { agentId: doc.agentId.toString(), printerKey: doc.printerKey };
      refs.set(`${ref.agentId}|${ref.printerKey}`, ref);
    }
    return [...refs.values()];
  }

  /** Queues a failed or expired job again (a retry). @returns null when it is not failed or expired. */
  async requeue(restaurantId: string, jobId: string): Promise<PrintJobRecord | null> {
    if (!Types.ObjectId.isValid(jobId)) return null;
    const doc = await this.jobs
      .findOneAndUpdate(
        { _id: oid(jobId), restaurantId: oid(restaurantId), status: { $in: ["failed", "expired"] } },
        { $set: { status: "queued", error: null, queuedAt: new Date() } },
        { returnDocument: "after" },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  /** Newest first, optionally of one status. */
  async list(restaurantId: string, status: PrintJobStatus | undefined, limit: number): Promise<PrintJobRecord[]> {
    const docs = await this.jobs
      .find({ restaurantId: oid(restaurantId), ...(status ? { status } : {}) })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    return docs.map(toRecord);
  }
}

type JobDoc = PrintJob & { _id: Types.ObjectId };

function toRecord(doc: JobDoc): PrintJobRecord {
  return {
    id: doc._id.toString(),
    restaurantId: doc.restaurantId.toString(),
    agentId: doc.agentId.toString(),
    printerKey: doc.printerKey,
    kind: doc.kind,
    label: doc.label,
    dedupeKey: doc.dedupeKey,
    orderId: doc.orderId?.toString() ?? null,
    orderRevision: doc.orderRevision ?? null,
    tableSessionId: doc.tableSessionId?.toString() ?? null,
    paymentId: doc.paymentId?.toString() ?? null,
    lines: doc.lines,
    paper: doc.paper,
    copies: doc.copies,
    status: doc.status,
    attempts: doc.attempts,
    error: doc.error ?? null,
    queuedAt: doc.queuedAt,
    printedAt: doc.printedAt ?? null,
    createdAt: doc.createdAt ?? doc._id.getTimestamp(),
  };
}
