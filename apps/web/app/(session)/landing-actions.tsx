"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";

/** CTAs of the landing page: depend on whether there is a session. */
export function LandingActions() {
  const { status } = useAuth();

  if (status === "loading") return <Skeleton className="h-11 w-64" aria-label="Cargando" />;

  if (status === "authenticated") {
    return (
      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <Link href="/admin">Ir al panel</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button asChild size="lg">
        <Link href="/registro">Crear cuenta</Link>
      </Button>
      <Button asChild size="lg" variant="outline">
        <Link href="/ingresar">Ingresar</Link>
      </Button>
    </div>
  );
}
