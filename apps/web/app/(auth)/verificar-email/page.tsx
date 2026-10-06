import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/components/auth-card";
import { VerifyEmail } from "./verify-email";

export const metadata: Metadata = { title: "Confirmar correo" };

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <VerifyEmail />
    </Suspense>
  );
}
