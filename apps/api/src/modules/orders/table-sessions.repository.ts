import type { PaymentMethod } from "@app/types";
import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { type ClientSession, type Model, Types } from "mongoose";
import { TableSession } from "./schemas/table-session.schema";

export interface TableSessionRecord {
  id: string;
  restaurantId: string;
  tableId: string;
  tableLabel: string;
  status: "open" | "closed";
  openedAt: Date;
  waiterCalledAt: Date | null;
  billRequestedAt: Date | null;
  requestedTip: number | null;
  closedAt: Date | null;
  closedBusinessDate: string | null;
  tip: number | null;
  paymentMethod: PaymentMethod | null;
  closedByName: string | null;
}

const oid = (id: string) => new Types.ObjectId(id);
const DUPLICATE_KEY = 11000;

/** Tenant-scoped: every method takes the restaurant id first and filters by it. */
@Injectable()
export class TableSessionsRepository {
  constructor(@InjectModel(TableSession.name) private readonly sessions: Model<TableSession>) {}

  /**
   * The open account of a table, opening one when there is none. Two first orders of the same table at the
   * same time end up in the same account: the unique index lets one insert win and the other reads it.
   */
  async getOrOpen(
    restaurantId: string,
    table: { id: string; label: string },
    session?: ClientSession,
  ): Promise<TableSessionRecord> {
    const filter = { restaurantId: oid(restaurantId), tableId: oid(table.id), status: "open" as const };
    try {
      const doc = await this.sessions
        .findOneAndUpdate(
          filter,
          { $setOnInsert: { tableLabel: table.label, openedAt: new Date() } },
          { upsert: true, returnDocument: "after", session },
        )
        .lean();
      return toRecord(doc!);
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      const doc = await this.sessions.findOne(filter, null, { session }).lean();
      if (!doc) throw error;
      return toRecord(doc);
    }
  }

  async findOpenByTable(restaurantId: string, tableId: string): Promise<TableSessionRecord | null> {
    const doc = await this.sessions.findOne({ restaurantId: oid(restaurantId), tableId: oid(tableId), status: "open" }).lean();
    return doc ? toRecord(doc) : null;
  }

  /** The table's latest account closed after `since` (the customer's phone shows "pagada" for a while). */
  async findRecentlyClosedByTable(restaurantId: string, tableId: string, since: Date): Promise<TableSessionRecord | null> {
    const doc = await this.sessions
      .findOne({ restaurantId: oid(restaurantId), tableId: oid(tableId), status: "closed", closedAt: { $gte: since } })
      .sort({ closedAt: -1 })
      .lean();
    return doc ? toRecord(doc) : null;
  }

  async findOne(restaurantId: string, sessionId: string): Promise<TableSessionRecord | null> {
    if (!Types.ObjectId.isValid(sessionId)) return null;
    const doc = await this.sessions.findOne({ _id: oid(sessionId), restaurantId: oid(restaurantId) }).lean();
    return doc ? toRecord(doc) : null;
  }

  /** Open accounts, oldest first (the floor). */
  async listOpen(restaurantId: string): Promise<TableSessionRecord[]> {
    const docs = await this.sessions.find({ restaurantId: oid(restaurantId), status: "open" }).sort({ openedAt: 1 }).lean();
    return docs.map(toRecord);
  }

  /** Accounts closed on business days from..to (inclusive): their tips. */
  async listClosedBetween(restaurantId: string, from: string, to: string): Promise<TableSessionRecord[]> {
    const docs = await this.sessions
      .find({ restaurantId: oid(restaurantId), status: "closed", closedBusinessDate: { $gte: from, $lte: to } })
      .lean();
    return docs.map(toRecord);
  }

  /** "Llamar al garzón": only the first call counts until someone attends. @returns null if not open. */
  async callWaiter(restaurantId: string, sessionId: string): Promise<TableSessionRecord | null> {
    // Only the first call stamps the time (the oldest call is attended first); later ones change nothing.
    await this.stampOnce(restaurantId, sessionId, "waiterCalledAt");
    return this.findOpen(restaurantId, sessionId);
  }

  /** The customer asks for the bill with a tip; asking again updates the tip. @returns null if not open. */
  async requestBill(restaurantId: string, sessionId: string, requestedTip: number): Promise<TableSessionRecord | null> {
    await this.stampOnce(restaurantId, sessionId, "billRequestedAt");
    return this.updateOpen(restaurantId, sessionId, { $set: { requestedTip } });
  }

  /** Sets a call timestamp only while it is empty (two phones pressing at once keep the first time). */
  private async stampOnce(restaurantId: string, sessionId: string, field: "waiterCalledAt" | "billRequestedAt"): Promise<void> {
    if (!Types.ObjectId.isValid(sessionId)) return;
    await this.sessions.updateOne(
      { _id: oid(sessionId), restaurantId: oid(restaurantId), status: "open", [field]: null },
      { $set: { [field]: new Date() } },
    );
  }

  private async findOpen(restaurantId: string, sessionId: string): Promise<TableSessionRecord | null> {
    if (!Types.ObjectId.isValid(sessionId)) return null;
    const doc = await this.sessions.findOne({ _id: oid(sessionId), restaurantId: oid(restaurantId), status: "open" }).lean();
    return doc ? toRecord(doc) : null;
  }

  /** A waiter attended the call (or the bill request). @returns null if not open. */
  async attend(restaurantId: string, sessionId: string, kind: "waiter" | "bill"): Promise<TableSessionRecord | null> {
    return this.updateOpen(restaurantId, sessionId, {
      $set: kind === "waiter" ? { waiterCalledAt: null } : { billRequestedAt: null },
    });
  }

  /**
   * Closes an account that is still open (two waiters charging the same table: only one succeeds).
   * @returns The closed account, or null if it was not open any more.
   */
  async close(
    restaurantId: string,
    sessionId: string,
    change: { tip: number; method: PaymentMethod; byUserId: string; byName: string | null; businessDate: string },
    session?: ClientSession,
  ): Promise<TableSessionRecord | null> {
    return this.updateOpen(
      restaurantId,
      sessionId,
      {
        $set: {
          status: "closed",
          closedAt: new Date(),
          closedBusinessDate: change.businessDate,
          tip: change.tip,
          paymentMethod: change.method,
          closedBy: oid(change.byUserId),
          closedByName: change.byName,
          waiterCalledAt: null,
          billRequestedAt: null,
        },
      },
      session,
    );
  }

  private async updateOpen(
    restaurantId: string,
    sessionId: string,
    update: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<TableSessionRecord | null> {
    if (!Types.ObjectId.isValid(sessionId)) return null;
    const doc = await this.sessions
      .findOneAndUpdate({ _id: oid(sessionId), restaurantId: oid(restaurantId), status: "open" }, update, {
        returnDocument: "after",
        session,
      })
      .lean();
    return doc ? toRecord(doc) : null;
  }
}

type SessionDoc = TableSession & { _id: Types.ObjectId };

function toRecord(doc: SessionDoc): TableSessionRecord {
  return {
    id: doc._id.toString(),
    restaurantId: doc.restaurantId.toString(),
    tableId: doc.tableId.toString(),
    tableLabel: doc.tableLabel,
    status: doc.status,
    openedAt: doc.openedAt,
    waiterCalledAt: doc.waiterCalledAt ?? null,
    billRequestedAt: doc.billRequestedAt ?? null,
    requestedTip: doc.requestedTip ?? null,
    closedAt: doc.closedAt ?? null,
    closedBusinessDate: doc.closedBusinessDate ?? null,
    tip: doc.tip ?? null,
    paymentMethod: doc.paymentMethod ?? null,
    closedByName: doc.closedByName ?? null,
  };
}
