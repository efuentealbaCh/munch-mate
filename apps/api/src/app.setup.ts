import { type INestApplication, ValidationPipe } from "@nestjs/common";
import { Logger } from "nestjs-pino";

/**
 * Applies the global configuration shared by `main.ts` and the e2e tests,
 * so tests exercise the app exactly as it runs in production.
 * @param app Nest application created with `bufferLogs: true`.
 */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
}
