import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import type { ApiEnv } from "./config/env.validation";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApp(app);

  const port = app.get(ConfigService<ApiEnv, true>).get("PORT", { infer: true });
  await app.listen(port, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  // The pino logger may not exist yet if bootstrap failed early (e.g. invalid env), so use stderr directly.
  process.stderr.write(`api failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
