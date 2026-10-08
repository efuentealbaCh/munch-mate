import type { RestaurantRole } from "./restaurants";

/**
 * Jobs of the `email` queue. The job name is the template; the payload carries only what the template renders.
 *
 * One-time links (verification, password reset, invitations) travel inside the payload because only their
 * hash is stored in MongoDB. Valkey is never exposed outside the Docker network and the links expire in 24 h.
 */
export interface EmailJobs {
  "verify-email": { to: string; name: string; url: string };
  "password-reset": { to: string; name: string; url: string };
  "staff-invitation": {
    to: string;
    restaurantName: string;
    inviterName: string;
    roles: RestaurantRole[];
    url: string;
  };
  /** Pickup order accepted: tracking link (holds the order's access token) and the PDF receipt attached. */
  "order-confirmation": {
    to: string;
    customerName: string;
    restaurantName: string;
    restaurantPhone: string;
    ticketNumber: number;
    /** Already formatted for display in the restaurant's timezone ("13:45"), or null. */
    readyAt: string | null;
    /** Already formatted ("$10.470"). */
    total: string;
    trackingUrl: string;
    attachment: { key: string; filename: string };
  };
}

export type EmailTemplate = keyof EmailJobs;

/** Union of every email job, discriminated by `template`. */
export type EmailJob = {
  [T in EmailTemplate]: { template: T; data: EmailJobs[T] };
}[EmailTemplate];
