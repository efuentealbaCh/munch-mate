import { Module } from "@nestjs/common";
import { MapsController } from "./maps.controller";
import { MapsService } from "./maps.service";

/** Self-hosted base map (PMTiles + fonts + sprites in the private bucket, uploaded by `pnpm maps:init`). */
@Module({
  controllers: [MapsController],
  providers: [MapsService],
  exports: [MapsService],
})
export class MapsModule {}
