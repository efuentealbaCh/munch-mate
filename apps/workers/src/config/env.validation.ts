import { z } from "zod";

/** Environment variables required by the workers. The process refuses to start if any is missing or invalid. */
export const envValidationSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\/\S+$/, "must be a mongodb:// or mongodb+srv:// URI"),
  VALKEY_URL: z.string().regex(/^rediss?:\/\/\S+$/, "must be a redis:// or rediss:// URL"),
  /** Internal port for the Docker healthcheck. Never published outside the container. 0 = random (tests). */
  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(3001),
});

export type WorkersEnv = z.infer<typeof envValidationSchema>;
