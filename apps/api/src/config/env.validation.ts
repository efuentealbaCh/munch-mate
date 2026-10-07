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
  /**
   * HMAC key that derives each order's tracking token from its client order id, so a retried submission
   * gets the same token back. Rotating it invalidates the tracking links of existing orders.
   */
  ORDER_TOKEN_SECRET: z.string().min(32, "must be at least 32 characters"),

  // Object storage (Garage, S3-compatible).
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  /** Private bucket: PDFs and anything that must not be public. */
  S3_BUCKET: z.string().min(3),
  /** Public bucket served by Garage's website endpoint (menu photos, logos). */
  S3_MEDIA_BUCKET: z.string().min(3),
  /** Base URL browsers load media from; object keys are appended to it. */
  MEDIA_PUBLIC_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, "")),
});

export type ApiEnv = z.infer<typeof envValidationSchema>;
