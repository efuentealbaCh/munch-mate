import type { PushNotification } from "./customers";
import type { ExpectedPaymentView, OrderChannel, OrderDeliveryView, OrderItemView } from "./orders";

/**
 * BullMQ queue names shared by the api (producer) and the workers (consumers).
 * Feature queues (`pdf`, `notif`) are added in their phases.
 */
export const QUEUES = {
  SYSTEM: "system",
  EMAIL: "email",
  PDF: "pdf",
  NOTIF: "notif",
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

/**
 * `pdf:receipt` — internal receipt of a pickup or delivery order (not a tax document), generated when it is accepted.
 * Carries the data to print, like QrSheetJob: the order items are an immutable snapshot anyway.
 * When `email` is set, the worker enqueues the confirmation email with the PDF attached once it is stored.
 */
export interface ReceiptJob {
  restaurantId: string;
  orderId: string;
  /** Private-bucket key where the worker stores the PDF. */
  outputKey: string;
  receipt: {
    restaurant: { name: string; phone: string };
    number: number;
    ticketNumber: number;
    channel: OrderChannel;
    createdAt: string;
    estimatedReadyAt: string | null;
    /** IANA zone used to print dates and times. */
    timezone: string;
    customerName: string;
    customerPhone: string;
    items: OrderItemView[];
    subtotal: number;
    deliveryFee: number;
    total: number;
    currency: string;
    note: string;
    delivery: OrderDeliveryView | null;
    expectedPayment: ExpectedPaymentView | null;
  };
  email: { to: string; trackingUrl: string } | null;
}

/**
 * `notif:push` — one web-push notification to a set of browser subscriptions. Carries the subscriptions
 * (endpoint + keys) because the api already resolved the recipients; the worker deletes the ones the push
 * service reports as gone (404/410).
 */
export interface NotifJob {
  subscriptions: { endpoint: string; keys: { p256dh: string; auth: string } }[];
  notification: PushNotification;
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
