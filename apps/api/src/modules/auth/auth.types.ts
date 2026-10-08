import type { Request } from "express";

/** Identity attached to the request by the access-token guard. */
export interface AuthUser {
  id: string;
  sessionId: string;
  emailVerified: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/** Client data stored with each session, to show the user where they are logged in. */
export interface ClientContext {
  ip: string | null;
  userAgent: string | null;
}
