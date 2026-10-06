import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { HealthServer } from "./health.server";

@Module({
  imports: [DiscoveryModule],
  providers: [HealthServer],
  exports: [HealthServer],
})
export class HealthModule {}
