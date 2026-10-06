/**
 * BullMQ queue names shared by the api (producer) and the workers (consumers).
 * Feature queues (`pdf`, `notif`) are added in their phases.
 */
export const QUEUES = {
  SYSTEM: "system",
  EMAIL: "email",
} as const;

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
