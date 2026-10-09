import { Inject, Injectable } from "@nestjs/common";
import { type HealthCheckAttempt, HealthIndicatorService } from "@nestjs/terminus";
import type { Redis } from "ioredis";
import { VALKEY } from "../../infra/redis/redis.module";

@Injectable()
export class ValkeyHealthIndicator {
  constructor(
    private readonly indicator: HealthIndicatorService,
    @Inject(VALKEY) private readonly client: Redis,
  ) {}

  /**
   * Checks that Valkey answers a PING.
   * @param key Name of the indicator in the health response.
   * @param timeoutMs Time after which the indicator is reported as down. ioredis queues commands while
   *   reconnecting instead of failing, so without a timeout the health endpoint would hang.
   */
  pingCheck<const Key extends string>(key: Key, timeoutMs = 1500): HealthCheckAttempt<Key> {
    return this.indicator
      .check(key)
      .attempt(async () => {
        await this.client.ping();
      })
      .withTimeout(timeoutMs);
  }
}
