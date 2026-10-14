"use client";

import { RotateCcwIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cameraAngle, type CameraTurns } from "@/lib/live-floor";
import { cn } from "@/lib/utils";

/**
 * Turns the camera of the live view a quarter to either side (keys «[» and «]»), with a mini compass of the
 * current angle: its arrow points where the plan's top edge (as the owner drew it) is now. Only the camera
 * turns; the saved plan does not change.
 */
export function CameraControls({ turns, onTurn, className }: { turns: CameraTurns; onTurn(delta: -1 | 1): void; className?: string }) {
  const angle = cameraAngle(turns);
  return (
    <div className={cn("flex items-center gap-1", className)} role="group" aria-label="Cámara del plano" data-testid="live-camera-controls">
      <Button variant="outline" size="icon-sm" onClick={() => onTurn(-1)} aria-label="Girar a la izquierda" title="Girar a la izquierda ([)" aria-keyshortcuts="[">
        <RotateCcwIcon aria-hidden />
      </Button>
      <span
        className="grid size-7 place-items-center rounded-full border border-border bg-background/80"
        role="img"
        aria-label={`Ángulo ${angle}°`}
        title={`Ángulo ${angle}°`}
        data-testid="camera-angle"
        data-angle={angle}
      >
        <svg viewBox="-10 -10 20 20" className="size-5" aria-hidden>
          {[0, 90, 180, 270].map((tick) => (
            <circle key={tick} cx={0} cy={-7.5} r={tick === angle ? 0 : 0.9} transform={`rotate(${tick})`} fill="currentColor" opacity={0.35} />
          ))}
          <g transform={`rotate(${angle})`}>
            <path d="M0 -7.5 L3 -1 L0 -2.4 L-3 -1 Z" fill="var(--primary)" />
            <circle r={1.3} fill="currentColor" opacity={0.55} />
          </g>
        </svg>
      </span>
      <Button variant="outline" size="icon-sm" onClick={() => onTurn(1)} aria-label="Girar a la derecha" title="Girar a la derecha (])" aria-keyshortcuts="]">
        <RotateCwIcon aria-hidden />
      </Button>
    </div>
  );
}
