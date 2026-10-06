import { z } from "zod";

/** Environment variables required by the api. The app refuses to start if any is missing or invalid. */
export const envValidationSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\/\S+$/, "must be a mongodb:// or mongodb+srv:// URI"),
  VALKEY_URL: z.string().regex(/^rediss?:\/\/\S+$/, "must be a redis:// or rediss:// URL"),
  /** Public origin of the app (web and api share it). Used for links in emails, the CSRF Origin check and cookie flags. */
  APP_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, "")),
  /** HS256 secret for access tokens. Rotating it logs every user out within 15 minutes. */
  JWT_ACCESS_SECRET: z.string().min(32, "must be at least 32 characters"),
});

export type ApiEnv = z.infer<typeof envValidationSchema>;
