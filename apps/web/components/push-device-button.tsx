"use client";

import { BellCheckIcon, BellPlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useDevicePush } from "@/hooks/use-push";

/**
 * On/off switch for this device's account notifications (staff board, riders). Renders nothing when push is
 * off on the server or the browser cannot do it; on iPhone without installing, a tap explains how.
 * @param label Text while off ("Activar avisos en este dispositivo").
 */
export function PushDeviceButton({ userId, label }: { userId: string; label: string }) {
  const push = useDevicePush(userId);
  if (push.state.kind === "hidden") return null;
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={push.active ? "secondary" : "outline"}
        onClick={push.toggle}
        aria-pressed={push.active}
        disabled={push.busy}
        aria-busy={push.busy || undefined}
        data-testid="push-device-button"
      >
        {push.busy ? (
          <Spinner aria-hidden data-icon="inline-start" />
        ) : push.active ? (
          <BellCheckIcon aria-hidden data-icon="inline-start" />
        ) : (
          <BellPlusIcon aria-hidden data-icon="inline-start" />
        )}
        {push.active ? "Avisos activados" : label}
      </Button>
      {push.message ? (
        <p className="max-w-xs text-sm text-muted-foreground" role="status">
          {push.message}
        </p>
      ) : null}
    </div>
  );
}
