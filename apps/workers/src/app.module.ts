import { join } from "node:path";
import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { LoggerModule } from "nestjs-pino";
import { envValidationSchema, type WorkersEnv } from "./config/env.validation";
import { EmailModule } from "./email/email.module";
import { HealthModule } from "./health/health.module";
import { PdfModule } from "./pdf/pdf.module";
import { SystemModule } from "./system/system.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // In dev the workers run from apps/workers and read the monorepo root .env; containers get real env vars.
      envFilePath: join(process.cwd(), "../../.env"),
      ignoreEnvFile: process.env.NODE_ENV === "production",
      expandVariables: true,
      validationSchema: envValidationSchema,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkersEnv, true>) => ({
        pinoHttp: {
          name: "workers",
          level: config.get("LOG_LEVEL", { infer: true }),
          transport:
            config.get("NODE_ENV", { infer: true }) === "development"
              ? { target: "pino-pretty", options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkersEnv, true>) => ({
        uri: config.get("MONGODB_URI", { infer: true }),
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkersEnv, true>) => ({
        // BullMQ workers need maxRetriesPerRequest: null so blocking commands survive Valkey reconnects.
        connection: { url: config.get("VALKEY_URL", { infer: true }), maxRetriesPerRequest: null },
      }),
    }),
    HealthModule,
    SystemModule,
    EmailModule,
    PdfModule,
  ],
})
export class AppModule {}
