import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { Logger } from "nestjs-pino";
import type { ApiEnv } from "./config/env.validation";
import { RedisIoAdapter } from "./infra/redis/redis-io.adapter";

/**
 * Applies the global configuration shared by `main.ts` and the e2e tests,
 * so tests exercise the app exactly as it runs in production.
 * @param app Nest application created with `bufferLogs: true`.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService<ApiEnv, true>);
  app.useLogger(app.get(Logger));
  // Requests arrive through Caddy (Docker network) or the Next dev proxy (loopback): trust them for
  // X-Forwarded-For, so rate limits and sessions see the real client IP instead of the proxy's.
  app.set("trust proxy", "loopback, linklocal, uniquelocal");
  app.disable("x-powered-by");
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useWebSocketAdapter(
    new RedisIoAdapter(
      app,
      config.get("VALKEY_URL", { infer: true }),
      new URL(config.get("APP_URL", { infer: true })).origin,
    ),
  );
  app.enableShutdownHooks();
}
