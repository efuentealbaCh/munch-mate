import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "./admin-shell";

export const metadata: Metadata = { title: { default: "Panel", template: "%s · Munch Mate" } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
