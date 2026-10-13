import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { VALKEY } from "../../infra/redis/redis.module";

/** A socket counts as connected for this long after its last heartbeat (Socket.IO pings every 25 s). */
export const PRESENCE_TTL_MS = 90_000;

const key = (agentId: string) => `cache:print-agent-online:${agentId}`;

/**
 * Which print agents are connected right now, shared by every api replica through Valkey: one sorted set per
 * agent with its sockets, scored by when each one stops counting. A replica that dies without cleaning up
 * leaves entries that simply expire.
 */
@Injectable()
export class PrintAgentPresence {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  /** The socket is alive (connected, or answered a heartbeat). */
  async seen(agentId: string, socketId: string, now = Date.now()): Promise<void> {
    await this.valkey
      .multi()
      .zadd(key(agentId), now + PRESENCE_TTL_MS, socketId)
      .zremrangebyscore(key(agentId), "-inf", now)
      .pexpire(key(agentId), PRESENCE_TTL_MS * 2)
      .exec();
  }

  async gone(agentId: string, socketId: string): Promise<void> {
    await this.valkey.zrem(key(agentId), socketId);
  }

  /** Agents (of the given ids) with at least one live socket. */
  async onlineOf(agentIds: readonly string[], now = Date.now()): Promise<Set<string>> {
    if (agentIds.length === 0) return new Set();
    const pipeline = this.valkey.pipeline();
    for (const agentId of agentIds) pipeline.zcount(key(agentId), `(${now}`, "+inf");
    const results = (await pipeline.exec()) ?? [];
    return new Set(agentIds.filter((_, index) => Number(results[index]?.[1] ?? 0) > 0));
  }

  /** Forgets an agent (unpaired). */
  async clear(agentId: string): Promise<void> {
    await this.valkey.del(key(agentId));
  }
}
