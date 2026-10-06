import { z } from "zod";

/** "true"/"false" strings from the environment. z.coerce.boolean() would turn "false" into true. */
const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

/** Environment variables required by the workers. The process refuses to start if any is missing or invalid. */
export const envValidationSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\/\S+$/, "must be a mongodb:// or mongodb+srv:// URI"),
  VALKEY_URL: z.string().regex(/^rediss?:\/\/\S+$/, "must be a redis:// or rediss:// URL"),
  /** Internal port for the Docker healthcheck. Never published outside the container. 0 = random (tests). */
  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(3001),

  // SMTP: Mailpit in dev (localhost:1025, no auth), any provider in production.
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  /** true = implicit TLS (port 465). false = plain connection upgraded with STARTTLS when offered (587). */
  SMTP_SECURE: booleanString,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Sender shown to recipients, e.g. `Munch Mate <no-reply@munchmate.cl>`. */
  MAIL_FROM: z.string().min(3),
});

export type WorkersEnv = z.infer<typeof envValidationSchema>;
