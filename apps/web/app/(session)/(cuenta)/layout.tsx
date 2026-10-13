import type { ReactNode } from "react";
import { AdminShell } from "../admin/admin-shell";

/**
 * The signed-in person's own pages as a customer (/mi-cuenta, /mis-pedidos). Same protected shell as /admin
 * (session check, header with the user menu, redirect to /ingresar?next=… without a session).
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
