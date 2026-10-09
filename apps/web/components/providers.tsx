"use client";

import type { ReactNode } from "react";
import { HydrationMarker } from "@/components/hydration-marker";
import { Toaster } from "@/components/ui/sonner";

/** Client-side providers shared by every page, public ones included (no session here: see SessionProviders). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-center" richColors closeButton />
      <HydrationMarker />
    </>
  );
}
