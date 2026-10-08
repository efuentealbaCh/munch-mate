import { Global, Module } from "@nestjs/common";
import { MediaService } from "./media.service";
import { StorageService } from "./storage.service";

@Global()
@Module({
  providers: [StorageService, MediaService],
  exports: [StorageService, MediaService],
})
export class StorageModule {}
