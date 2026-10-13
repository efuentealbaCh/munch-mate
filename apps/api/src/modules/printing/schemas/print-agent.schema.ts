import {
  KITCHEN_PRINT_RULES,
  type KitchenPrintRule,
  PRINT_LIMITS,
  PRINT_PAPERS,
  PRINTER_KINDS,
  type PrinterKind,
  type PrintPaper,
} from "@app/types";
import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { type HydratedDocument, Types } from "mongoose";

/** A printer of an agent: reported by the agent (key, name, kind), configured by the owner (the rest). */
@Schema({ _id: false })
export class AgentPrinterDoc {
  /** Stable id chosen by the agent ("usb:<queue>", "net:<ip>:<port>"); the owner's settings are kept per key. */
  @Prop({ required: true, maxlength: PRINT_LIMITS.printerKeyMax })
  key!: string;

  @Prop({ required: true, maxlength: PRINT_LIMITS.printerNameMax })
  name!: string;

  @Prop({ type: String, enum: PRINTER_KINDS, required: true })
  kind!: PrinterKind;

  @Prop({ default: false })
  enabled!: boolean;

  @Prop({ type: String, enum: PRINT_PAPERS, default: "80" })
  paper!: PrintPaper;

  @Prop({ type: String, enum: KITCHEN_PRINT_RULES, default: "off" })
  kitchen!: KitchenPrintRule;

  /** Menu categories of the same restaurant ([] = every category). */
  @Prop({ type: [Types.ObjectId], default: [] })
  categoryIds!: Types.ObjectId[];

  @Prop({ default: false })
  receipts!: boolean;

  @Prop({ default: 1, min: PRINT_LIMITS.copiesMin, max: PRINT_LIMITS.copiesMax })
  copies!: number;

  /** It came in the agent's last hello; unreported printers keep their settings but get no jobs. */
  @Prop({ default: true })
  reported!: boolean;
}

/**
 * A print agent paired with a restaurant (phase 8): a program on one of its computers that prints on USB and
 * network receipt printers. It authenticates with a device token, of which only the SHA-256 is stored.
 * Unpairing sets `revokedAt` (the document stays, so its jobs keep their agent).
 */
@Schema({ collection: "print_agents", timestamps: true })
export class PrintAgent {
  @Prop({ type: Types.ObjectId, required: true })
  restaurantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: PRINT_LIMITS.agentNameMax })
  name!: string;

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ default: "", maxlength: PRINT_LIMITS.appVersionMax })
  appVersion!: string;

  @Prop({ type: Date, default: null })
  lastSeenAt!: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: [SchemaFactory.createForClass(AgentPrinterDoc)], default: [] })
  printers!: AgentPrinterDoc[];
}

export type PrintAgentDocument = HydratedDocument<PrintAgent>;
export const PrintAgentSchema = SchemaFactory.createForClass(PrintAgent);
PrintAgentSchema.index({ restaurantId: 1, revokedAt: 1 });
