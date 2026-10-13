"use client";

import type { PairingCodeView } from "@app/types";
import { formatPairingCode } from "@app/utils";
import { CopyIcon, LinkIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/hooks/use-now";
import { printAgentsApi } from "@/lib/endpoints";
import { pairingCountdown } from "@/lib/printers";

/**
 * «Vincular un equipo»: a one-time code (10 min) typed into Munch Mate Impresora on the computer. While it is
 * shown the screen refreshes the list every few seconds (the parent), and closes it when the computer appears.
 * @param open The code is on screen (the parent polls faster and watches for the new computer).
 */
export function PairingCard({
  restaurantId,
  open,
  onOpen,
  onClose,
}: {
  restaurantId: string;
  open: boolean;
  onOpen(): void;
  onClose(): void;
}) {
  const [pairing, setPairing] = useState<PairingCodeView | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Closed by the parent (the computer was paired): the code was used, forget it.
  useEffect(() => {
    if (!open) setPairing(null);
  }, [open]);

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const code = await printAgentsApi.pairingCode(restaurantId);
      setPairing(code);
      onOpen();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="pairing-title"
      className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5"
      data-testid="pairing-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="pairing-title" className="font-semibold">
            Vincular un equipo
          </h3>
          <p className="text-sm text-muted-foreground">
            Genera un código y escríbelo en Munch Mate Impresora. Sirve una sola vez.
          </p>
        </div>
        {open && pairing ? (
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Ocultar el código">
            <XIcon aria-hidden />
          </Button>
        ) : (
          <Button onClick={() => void generate()} disabled={pending} aria-busy={pending || undefined} data-testid="pairing-generate">
            {pending ? <Spinner aria-hidden data-icon="inline-start" /> : <LinkIcon aria-hidden data-icon="inline-start" />}
            Vincular un equipo
          </Button>
        )}
      </div>
      <FormError error={error} />
      {open && pairing ? <PairingCode pairing={pairing} pending={pending} onRegenerate={() => void generate()} /> : null}
    </section>
  );
}

function PairingCode({ pairing, pending, onRegenerate }: { pairing: PairingCodeView; pending: boolean; onRegenerate(): void }) {
  const now = useNow(1_000);
  const countdown = pairingCountdown(pairing.expiresAt, now);
  const formatted = formatPairingCode(pairing.code);

  async function copy() {
    try {
      await navigator.clipboard.writeText(formatted);
      toast.success("Código copiado");
    } catch {
      toast.error("No pudimos copiarlo. Escríbelo tal como se ve.");
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-brand-soft px-4 py-5 text-center">
      {countdown.expired ? (
        <p className="text-sm font-medium" role="status">
          El código venció. Genera otro para vincular el equipo.
        </p>
      ) : (
        <>
          <p className="text-sm">Abre Munch Mate Impresora en el computador y escribe este código:</p>
          <p
            className="font-mono text-4xl font-black tracking-widest tabular-nums select-all sm:text-5xl"
            data-testid="pairing-code"
          >
            {formatted}
          </p>
          <p className="text-sm text-muted-foreground" aria-live="off">
            Vence en <span className="tabular-nums">{countdown.label}</span>. Esta pantalla muestra el equipo apenas se vincule.
          </p>
        </>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {countdown.expired ? null : (
          <Button variant="outline" onClick={() => void copy()}>
            <CopyIcon aria-hidden data-icon="inline-start" />
            Copiar
          </Button>
        )}
        <Button variant={countdown.expired ? "default" : "ghost"} onClick={onRegenerate} disabled={pending} aria-busy={pending || undefined}>
          {pending ? <Spinner aria-hidden data-icon="inline-start" /> : <RefreshCwIcon aria-hidden data-icon="inline-start" />}
          Generar otro
        </Button>
      </div>
    </div>
  );
}
