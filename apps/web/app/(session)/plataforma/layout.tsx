import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "../admin/admin-shell";

/* Same protected shell as /admin: session check, header with the user menu, email verification banner. */

export const metadata: Metadata = { title: { default: "Plataforma", template: "%s · Munch Mate" }, robots: { index: false } };

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
