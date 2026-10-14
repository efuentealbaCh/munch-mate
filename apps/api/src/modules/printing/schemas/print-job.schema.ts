import {
  PRINT_JOB_KINDS,
  PRINT_JOB_STATUSES,
  PRINT_LIMITS,
  PRINT_PAPERS,
  type PrintJobKind,
  type PrintJobStatus,
  type PrintLine,
  type PrintPaper,
} from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/**
 * One ticket for one printer of one agent (phase 8). `dedupeKey` is deterministic per event and printer, so
 * the same event (a retried request, two api replicas) never prints twice: the unique index lets one in.
 * Jobs are deleted `PRINT_LIMITS.jobsKeepDays` after creation (TTL index).
 */
@Schema({ collection: "print_jobs", timestamps: true })
export class PrintJob {
  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  agentId!: Types.ObjectId;

  @Prop({ required: true })
  printerKey!: string;

  @Prop({ type: String, enum: PRINT_JOB_KINDS, required: true })
  kind!: PrintJobKind;

  /** "Comanda #12", "Comprobante Mesa 4": how the staff recognize it in the failed list. */
  @Prop({ required: true })
  label!: string;

  @Prop({ required: true })
  dedupeKey!: string;

  @Prop({ type: Types.ObjectId, default: null })
  orderId!: Types.ObjectId | null;

  /** The order's `revision` the ticket shows (kitchen tickets). */
  @Prop({ type: Number, default: null })
  orderRevision!: number | null;

  @Prop({ type: Types.ObjectId, default: null })
  tableSessionId!: Types.ObjectId | null;

  /** The table payment a receipt is for. */
  @Prop({ type: Types.ObjectId, default: null })
  paymentId!: Types.ObjectId | null;

  /** Rows laid out for `paper` (`layoutTicket`), stored as sent. */
  @Prop({ type: [Object], required: true })
  lines!: PrintLine[];

  @Prop({ type: String, enum: PRINT_PAPERS, required: true })
  paper!: PrintPaper;

  @Prop({ required: true, min: PRINT_LIMITS.copiesMin, max: PRINT_LIMITS.copiesMax })
  copies!: number;

  @Prop({ type: String, enum: PRINT_JOB_STATUSES, default: "queued" })
  status!: PrintJobStatus;

  /** Times it was sent to the agent. */
  @Prop({ default: 0 })
  attempts!: number;

  @Prop({ type: String, default: null })
  error!: string | null;

  /** When it was queued (or queued again by a retry): expiry counts from here. */
  @Prop({ type: Date, required: true })
  queuedAt!: Date;

  @Prop({ type: Date, default: null })
  printedAt!: Date | null;

  createdAt!: Date;
}

export type PrintJobDocument = HydratedDocument<PrintJob>;
export const PrintJobSchema = SchemaFactory.createForClass(PrintJob);
PrintJobSchema.index({ restaurantId: 1, dedupeKey: 1 }, { unique: true });
PrintJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: PRINT_LIMITS.jobsKeepDays * 24 * 3600 });
// Pending jobs of an agent (re-sent when it connects).
PrintJobSchema.index({ agentId: 1, status: 1, queuedAt: 1 });
// Which printers already have a kitchen ticket of an order (edits), and the failed list.
PrintJobSchema.index({ restaurantId: 1, orderId: 1 });
PrintJobSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
