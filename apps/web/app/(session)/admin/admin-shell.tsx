"use client";

import { CloudOffIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/errors";
import { withQuery } from "@/lib/safe-next";
import { UserMenu } from "./user-menu";
import { VerifyEmailBanner } from "./verify-email-banner";

/**
 * Protected area. Sessions live in httpOnly cookies that a proxy/middleware cannot see reliably, so the
 * guard is client-side: wait for the AuthProvider, then send anonymous visitors to the login page with
 * `next` pointing back here. The api enforces access on every request anyway.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, user, logout, reloadProfile } = useAuth();
  // Set while logging out on purpose, so the guard does not redirect to /ingresar?next=… meanwhile.
  const leaving = useRef(false);

  useEffect(() => {
    if (status !== "unauthenticated" || leaving.current) return;
    const next = `${pathname}${window.location.search}`;
    router.replace(withQuery("/ingresar", { next }));
  }, [status, pathname, router]);

  async function handleLogout() {
    leaving.current = true;
    try {
      await logout();
      router.replace("/ingresar");
    } catch (error) {
      leaving.current = false;
      toast.error(errorMessage(error));
    }
  }

  if (status === "error") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <CloudOffIcon className="size-10 text-muted-foreground" aria-hidden />
        <div role="alert">
          <h1 className="text-lg font-semibold">No pudimos conectar con el servidor</h1>
          <p className="text-sm text-muted-foreground">Revisa tu conexión e intenta de nuevo.</p>
        </div>
        <Button onClick={() => void reloadProfile()}>Reintentar</Button>
      </div>
    );
  }

  if (status !== "authenticated" || !user) {
    return (
      <div aria-busy="true" aria-label="Cargando">
        <div className="border-b bg-card">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="size-9 rounded-full" />
          </div>
        </div>
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <Brand href="/admin" />
          <UserMenu user={user} onLogout={handleLogout} />
        </div>
      </header>
      {user.emailVerified ? null : <VerifyEmailBanner email={user.email} />}
      <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
