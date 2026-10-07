import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardSkeleton } from "@/components/auth-card";
import { InvitationView } from "./invitation-view";

export const metadata: Metadata = { title: "Invitación" };

export default function InvitationPage() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <InvitationView />
    </Suspense>
  );
}
