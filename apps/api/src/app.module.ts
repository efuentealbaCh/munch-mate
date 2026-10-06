import { join } from "node:path";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { LoggerModule } from "nestjs-pino";
import { type ApiEnv, envValidationSchema } from "./config/env.validation";
import { RedisModule } from "./infra/redis/redis.module";
import { HealthModule } from "./modules/health/health.module";

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
          redact: ["req.headers.authorization", "req.headers.cookie"],
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
    HealthModule,
  ],
})
export class AppModule {}
