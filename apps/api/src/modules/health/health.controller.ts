import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService, MongooseHealthIndicator } from "@nestjs/terminus";
import { ValkeyHealthIndicator } from "./valkey.health";

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
