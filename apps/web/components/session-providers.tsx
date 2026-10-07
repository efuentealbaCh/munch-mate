"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";

/**
 * Session state for the pages that need it (landing, login/registration, /admin). Kept out of the root
 * layout on purpose: the public customer pages (/r, /m, /pedido) must not call /api/auth/* — for an
 * anonymous visitor that meant one /auth/me plus two /auth/refresh 401s on every menu view.
 */
export function SessionProviders({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
