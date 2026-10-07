"use client";

import { MailWarningIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth-context";
import { authApi } from "@/lib/endpoints";
import { errorMessage } from "@/lib/errors";

/** Shown while the email is not verified (owners need it to create a restaurant). */
export function VerifyEmailBanner({ email }: { email: string }) {
  const { syncSession } = useAuth();
  const [pending, setPending] = useState<"resend" | "check" | null>(null);

  async function resend() {
    setPending("resend");
    try {
      await authApi.resendVerification();
      toast.success(`Te enviamos un nuevo enlace a ${email}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  async function check() {
    setPending("check");
    try {
      const profile = await syncSession();
      // If it worked the banner disappears; if not, say so instead of doing nothing.
      if (profile?.emailVerified) toast.success("¡Correo confirmado!");
      else toast.info("Todavía no vemos tu correo confirmado. Abre el enlace que te enviamos.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="border-b border-warning-foreground/20 bg-warning text-warning-foreground" role="region" aria-label="Correo sin confirmar">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm">
          <MailWarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Confirma tu correo <strong className="break-all">{email}</strong> para crear tu restaurante. Revisa tu bandeja de
            entrada.
          </span>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => void check()}>
            {pending === "check" ? <Spinner aria-hidden /> : null}
            Ya lo confirmé
          </Button>
          <Button size="sm" disabled={pending !== null} onClick={() => void resend()}>
            {pending === "resend" ? <Spinner aria-hidden /> : null}
            Reenviar correo
          </Button>
        </div>
      </div>
    </div>
  );
}
