import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import type { ClientSession, Model } from "mongoose";
import { Counter } from "./schemas/counter.schema";

@Injectable()
export class CountersRepository {
  constructor(@InjectModel(Counter.name) private readonly counters: Model<Counter>) {}

  /**
   * Atomically increments a sequence (creating it at 1). Inside the order transaction, so an order that
   * fails to insert does not burn a number.
   */
  async next(name: string, session?: ClientSession): Promise<number> {
    const doc = await this.counters
      .findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after", session })
      .lean();
    return doc!.seq;
  }
}
