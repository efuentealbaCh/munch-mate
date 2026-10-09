/**
 * Body of every api error response. `code` is stable and meant for the frontend to branch on;
 * `message` is human-readable (Spanish) and may change.
 */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  /** Field-level validation messages, only for VALIDATION_FAILED. */
  details?: string[];
  /** Machine-readable extras for specific codes, e.g. `{ suggestion }` on SLUG_TAKEN. */
  meta?: Record<string, string>;
}

/** Authenticated user as returned by `/api/auth/*`. Never includes secrets. */
export interface UserProfile {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  /** Saved for checkout (normalized, e.g. +56912345678); "" when not set. */
  phone: string;
  /** "admin" can manage every restaurant at /plataforma. */
  platformRole: "admin" | null;
}
