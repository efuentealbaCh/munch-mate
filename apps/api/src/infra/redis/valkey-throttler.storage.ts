import type { ThrottlerStorage } from "@nestjs/throttler";
import type { Redis } from "ioredis";

/** Not exported by @nestjs/throttler's public index, so derived from the interface instead of a deep import. */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage["increment"]>>;

/**
 * Fixed-window counter plus optional block, executed atomically in Valkey.
 * KEYS: [hits, block]. ARGV: [ttlMs, limit, blockMs]. Returns {hits, hitsTtlMs, blocked, blockTtlMs}.
 */
const INCREMENT_SCRIPT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  return { hits, math.max(redis.call('PTTL', KEYS[1]), 0), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local hitsTtl = redis.call('PTTL', KEYS[1])
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])
if hits > limit and block > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', block)
  return { hits, hitsTtl, 1, block }
end
if hits > limit then
  return { hits, hitsTtl, 1, 0 }
end
return { hits, hitsTtl, 0, 0 }
`;

/**
 * Throttler storage shared by every api replica (the default in-memory storage is per process).
 * Written in-house because @nest-lab/throttler-storage-redis does not declare NestJS 12 support yet.
 */
export class ValkeyThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly client: Redis) {}

  /**
   * @param key Hashed tracker key provided by the throttler guard.
   * @param ttl Window length in milliseconds.
   * @param limit Requests allowed per window.
   * @param blockDuration How long (ms) to block once the limit is exceeded; 0 = only until the window ends.
   * @param throttlerName Named throttler, so different limits on the same route do not share counters.
   * @returns Counters with times in seconds, as the throttler guard expects.
   */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `throttle:${throttlerName}:${key}`;
    const [hits, hitsTtl, blocked, blockTtl] = (await this.client.eval(
      INCREMENT_SCRIPT,
      2,
      base,
      `${base}:block`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];

    return {
      totalHits: hits,
      timeToExpire: Math.ceil(hitsTtl / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(blockTtl / 1000),
    };
  }
}
