import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService, MongooseHealthIndicator } from "@nestjs/terminus";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "../auth/decorators";
import { ValkeyHealthIndicator } from "./valkey.health";

// Skipping the throttler also keeps this endpoint answering 503 (not 500) when Valkey is down,
// since the throttler stores its counters in Valkey.
@Public()
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly mongoose: MongooseHealthIndicator,
    private readonly valkey: ValkeyHealthIndicator,
  ) {}

  /** Returns 200 only when MongoDB and Valkey are reachable; 503 otherwise. Used by Docker healthchecks. */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      this.mongoose.pingCheck("mongo").withTimeout(1500),
      this.valkey.pingCheck("valkey"),
    ]);
  }
}
