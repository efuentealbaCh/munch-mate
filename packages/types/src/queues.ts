/**
 * BullMQ queue names shared by the api (producer) and the workers (consumers).
 * Feature queues (`pdf`, `notif`) are added in their phases.
 */
export const QUEUES = {
  SYSTEM: "system",
  EMAIL: "email",
  PDF: "pdf",
} as const;

/**
 * `pdf:qr-sheet` — printable sheet with one QR per table.
 * Carries the data to render (not just ids): table URLs are printed on the tables anyway, and this keeps
 * the workers free of menu/table schemas.
 */
export interface QrSheetJob {
  restaurantId: string;
  restaurantName: string;
  tables: { label: string; url: string }[];
  /** Private-bucket key where the worker stores the PDF. */
  outputKey: string;
}

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Payload of the `system:ping` job, used to verify the api → Valkey → workers path. */
export interface PingJob {
  sentAt: string;
}

/** Result returned by the workers for a `system:ping` job. */
export interface PingJobResult {
  pong: true;
  receivedAt: string;
}
