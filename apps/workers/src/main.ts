import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

/** Starts the workers as a standalone Nest application: no public HTTP server, only BullMQ processors. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // On SIGTERM, @nestjs/bullmq closes each worker and waits for in-flight jobs before disconnecting.
  app.enableShutdownHooks();
  await app.init();
}

bootstrap().catch((error: unknown) => {
  // The pino logger may not exist yet if bootstrap failed early (e.g. invalid env), so use stderr directly.
  process.stderr.write(`workers failed to start: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
