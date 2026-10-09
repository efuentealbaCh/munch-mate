import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";

/** Injection token for the shared Valkey client (cache, rate limiting, health). */
export const VALKEY = Symbol("VALKEY");

@Global()
@Module({
  providers: [
    {
      provide: VALKEY,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        new Redis(config.getOrThrow<string>("VALKEY_URL"), { connectionName: "api" }),
    },
  ],
  exports: [VALKEY],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(VALKEY) private readonly client: Redis) {}

  /** Closes the connection gracefully so in-flight commands complete before the process exits. */
  async onApplicationShutdown(): Promise<void> {
    if (this.client.status === "ready") {
      await this.client.quit();
      return;
    }
    // quit() waits for a reply that never arrives while Valkey is unreachable, which would block shutdown
    // until Docker kills the container; drop the socket instead.
    this.client.disconnect();
  }
}
