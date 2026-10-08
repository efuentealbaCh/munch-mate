import { join } from "node:path";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { MongooseModule } from "@nestjs/mongoose";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import type { Redis } from "ioredis";
import { LoggerModule } from "nestjs-pino";
import { HttpExceptionFilter } from "./common/errors/http-exception.filter";
import { OriginGuard } from "./common/security/origin.guard";
import { type ApiEnv, envValidationSchema } from "./config/env.validation";
import { QueueModule } from "./infra/queue/queue.module";
import { RedisModule, VALKEY } from "./infra/redis/redis.module";
import { StorageModule } from "./infra/storage/storage.module";
import { ValkeyThrottlerStorage } from "./infra/redis/valkey-throttler.storage";
import { AccessTokenGuard } from "./modules/auth/access-token.guard";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { MenuModule } from "./modules/menu/menu.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";
import { RestaurantsModule } from "./modules/restaurants/restaurants.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // In dev the api runs from apps/api and reads the monorepo root .env; containers get real env vars.
      envFilePath: join(process.cwd(), "../../.env"),
      ignoreEnvFile: process.env.NODE_ENV === "production",
      expandVariables: true,
      validationSchema: envValidationSchema,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>) => ({
        pinoHttp: {
          level: config.get("LOG_LEVEL", { infer: true }),
          transport:
            config.get("NODE_ENV", { infer: true }) === "development"
              ? { target: "pino-pretty", options: { singleLine: true } }
              : undefined,
          // Docker hits /api/health every few seconds; logging it would drown real traffic.
          autoLogging: { ignore: (req) => req.url === "/api/health" },
          // The referer carries the page URL, which holds one-time tokens on /verificar-email,
          // /restablecer-contrasena and /invitacion.
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers.referer",
            'res.headers["set-cookie"]',
          ],
        },
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>) => ({
        uri: config.get("MONGODB_URI", { infer: true }),
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      }),
    }),
    RedisModule,
    QueueModule,
    StorageModule,
    ThrottlerModule.forRootAsync({
      inject: [VALKEY],
      useFactory: (valkey: Redis) => ({
        // Global default per client IP; sensitive routes override it with @Throttle.
        throttlers: [{ name: "default", ttl: 60_000, limit: 300 }],
        storage: new ValkeyThrottlerStorage(valkey),
      }),
    }),
    HealthModule,
    AuthModule,
    RestaurantsModule,
    MenuModule,
    RealtimeModule,
    OrdersModule,
  ],
  providers: [
    // Global guards run in this order: rate limit → CSRF origin check → session.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useExisting: AccessTokenGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
