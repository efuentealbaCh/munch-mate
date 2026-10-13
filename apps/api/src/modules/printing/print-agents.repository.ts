import type { AgentPrinter, AgentPrinterSettings } from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type Model, Types } from "mongoose";
import { type AgentPrinterDoc, PrintAgent } from "./schemas/print-agent.schema";

export interface PrintAgentRecord {
  id: string;
  restaurantId: string;
  name: string;
  appVersion: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  printers: AgentPrinter[];
}

const oid = (id: string) => new Types.ObjectId(id);
/** Agents that were not unpaired (older documents may lack the field). */
const ACTIVE = { revokedAt: null };

/**
 * Tenant-scoped: every method takes the restaurant id first and filters by it, except `findByTokenHash`, which
 * resolves the agent's own credential (the token identifies the restaurant, like a session does its user).
 */
@Injectable()
export class PrintAgentsRepository {
  constructor(@InjectModel(PrintAgent.name) private readonly agents: Model<PrintAgent>) {}

  async create(restaurantId: string, input: { name: string; tokenHash: string; appVersion: string }): Promise<PrintAgentRecord> {
    const doc = await this.agents.create({ ...input, restaurantId: oid(restaurantId), printers: [] });
    return toRecord(doc.toObject());
  }

  async countActive(restaurantId: string): Promise<number> {
    return this.agents.countDocuments({ restaurantId: oid(restaurantId), ...ACTIVE });
  }

  /** Paired agents (not revoked), oldest first. */
  async listActive(restaurantId: string): Promise<PrintAgentRecord[]> {
    const docs = await this.agents.find({ restaurantId: oid(restaurantId), ...ACTIVE }).sort({ createdAt: 1, _id: 1 }).lean();
    return docs.map(toRecord);
  }

  /** A paired agent (not revoked). */
  async findActive(restaurantId: string, agentId: string): Promise<PrintAgentRecord | null> {
    if (!Types.ObjectId.isValid(agentId)) return null;
    const doc = await this.agents.findOne({ _id: oid(agentId), restaurantId: oid(restaurantId), ...ACTIVE }).lean();
    return doc ? toRecord(doc) : null;
  }

  /** The agent behind a device token (SHA-256), unless it was unpaired. */
  async findByTokenHash(tokenHash: string): Promise<PrintAgentRecord | null> {
    const doc = await this.agents.findOne({ tokenHash, ...ACTIVE }).lean();
    return doc ? toRecord(doc) : null;
  }

  async rename(restaurantId: string, agentId: string, name: string): Promise<PrintAgentRecord | null> {
    return this.updateActive(restaurantId, agentId, { $set: { name } });
  }

  /**
   * Replaces the printers with the list the agent reported (already merged with the owner's settings by the
   * service) and stamps the connection.
   */
  async replacePrinters(
    restaurantId: string,
    agentId: string,
    printers: AgentPrinter[],
    appVersion: string,
    seenAt: Date,
  ): Promise<PrintAgentRecord | null> {
    return this.updateActive(restaurantId, agentId, {
      $set: { printers: printers.map(toPrinterDoc), appVersion, lastSeenAt: seenAt },
    });
  }

  /** Changes the owner's settings of one printer. @returns null when the agent or the printer is not there. */
  async updatePrinter(
    restaurantId: string,
    agentId: string,
    printerKey: string,
    settings: Partial<AgentPrinterSettings>,
  ): Promise<PrintAgentRecord | null> {
    if (!Types.ObjectId.isValid(agentId)) return null;
    const $set: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(settings)) {
      if (value === undefined) continue;
      $set[`printers.$.${field}`] = field === "categoryIds" ? (value as string[]).map(oid) : value;
    }
    const doc = await this.agents
      .findOneAndUpdate(
        { _id: oid(agentId), restaurantId: oid(restaurantId), ...ACTIVE, "printers.key": printerKey },
        { $set },
        { returnDocument: "after", runValidators: true },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  /** Removes one printer (it no longer exists). @returns null when the agent or the printer is not there. */
  async removePrinter(restaurantId: string, agentId: string, printerKey: string): Promise<PrintAgentRecord | null> {
    if (!Types.ObjectId.isValid(agentId)) return null;
    const doc = await this.agents
      .findOneAndUpdate(
        { _id: oid(agentId), restaurantId: oid(restaurantId), ...ACTIVE, "printers.key": printerKey },
        { $pull: { printers: { key: printerKey } } },
        { returnDocument: "after" },
      )
      .lean();
    return doc ? toRecord(doc) : null;
  }

  /** Stamps `lastSeenAt`, at most once per `minIntervalMs` (heartbeats arrive every ~25 s). */
  async touch(restaurantId: string, agentId: string, at: Date, minIntervalMs: number): Promise<void> {
    await this.agents.updateOne(
      {
        _id: oid(agentId),
        restaurantId: oid(restaurantId),
        $or: [{ lastSeenAt: null }, { lastSeenAt: { $lt: new Date(at.getTime() - minIntervalMs) } }],
      },
      { $set: { lastSeenAt: at } },
    );
  }

  /** Unpairs the agent: its token stops working. @returns null when it was not paired. */
  async revoke(restaurantId: string, agentId: string): Promise<PrintAgentRecord | null> {
    return this.updateActive(restaurantId, agentId, { $set: { revokedAt: new Date() } });
  }

  private async updateActive(
    restaurantId: string,
    agentId: string,
    update: Record<string, unknown>,
  ): Promise<PrintAgentRecord | null> {
    if (!Types.ObjectId.isValid(agentId)) return null;
    const doc = await this.agents
      .findOneAndUpdate({ _id: oid(agentId), restaurantId: oid(restaurantId), ...ACTIVE }, update, {
        returnDocument: "after",
        runValidators: true,
      })
      .lean();
    return doc ? toRecord(doc) : null;
  }
}

type AgentDoc = PrintAgent & { _id: Types.ObjectId; createdAt?: Date };

const toPrinterDoc = (printer: AgentPrinter) => ({ ...printer, categoryIds: printer.categoryIds.map(oid) });

function toPrinter(doc: AgentPrinterDoc): AgentPrinter {
  return {
    key: doc.key,
    name: doc.name,
    kind: doc.kind,
    enabled: doc.enabled,
    paper: doc.paper,
    kitchen: doc.kitchen,
    categoryIds: (doc.categoryIds ?? []).map((id) => id.toString()),
    receipts: doc.receipts,
    copies: doc.copies,
    // Printers stored before the field existed were reported.
    reported: doc.reported ?? true,
  };
}

function toRecord(doc: AgentDoc): PrintAgentRecord {
  return {
    id: doc._id.toString(),
    restaurantId: doc.restaurantId.toString(),
    name: doc.name,
    appVersion: doc.appVersion ?? "",
    createdAt: doc.createdAt ?? doc._id.getTimestamp(),
    lastSeenAt: doc.lastSeenAt ?? null,
    revokedAt: doc.revokedAt ?? null,
    printers: (doc.printers ?? []).map(toPrinter),
  };
}
