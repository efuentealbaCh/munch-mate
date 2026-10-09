import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

/** Centered single-column layout for login, registration, password and email/invitation links. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:justify-center sm:py-12">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Brand className="self-center" />
        <main>{children}</main>
      </div>
    </div>
  );
}
