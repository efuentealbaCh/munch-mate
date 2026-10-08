import type { ReactNode } from "react";
import { SessionProviders } from "@/components/session-providers";

/**
 * Route group for every page that knows about the session: landing, auth pages and /admin. One shared
 * AuthProvider, so moving from /ingresar to /admin keeps the profile instead of asking /auth/me again.
 */
export default function SessionLayout({ children }: { children: ReactNode }) {
  return <SessionProviders>{children}</SessionProviders>;
}
