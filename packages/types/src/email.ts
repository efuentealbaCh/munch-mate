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
}

export type EmailTemplate = keyof EmailJobs;

/** Union of every email job, discriminated by `template`. */
export type EmailJob = {
  [T in EmailTemplate]: { template: T; data: EmailJobs[T] };
}[EmailTemplate];
