"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Remembered per device: the kitchen tablet keeps the sound on between shifts. */
const STORAGE_KEY = "mm:board-sound";

function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function writePreference(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Storage disabled: the toggle still works for this visit.
  }
}

type AudioContextConstructor = typeof AudioContext;

function audioContextClass(): AudioContextConstructor | undefined {
  const w = window as Window & { webkitAudioContext?: AudioContextConstructor };
  return typeof AudioContext === "undefined" ? w.webkitAudioContext : AudioContext;
}

/** Two short rising tones (no audio file to download or cache). */
function playTones(context: AudioContext): void {
  const start = context.currentTime + 0.01;
  for (const [index, frequency] of [880, 1320].entries()) {
    const at = start + index * 0.18;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    // Quick attack and exponential release: avoids the click of a hard start/stop.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.3);
  }
}

export interface Chime {
  /** The staff wants sound (remembered in localStorage). */
  enabled: boolean;
  /** Enabled but the browser still blocks audio until the next tap on the page. */
  blocked: boolean;
  /** Must be called from a click/tap handler: that gesture is what unlocks audio. */
  toggle(): void;
  play(): void;
}

/**
 * New-order sound for the staff board, made with the Web Audio API. Browsers block audio until a user
 * gesture, so the sound is switched on by a button; after a reload the preference is kept and the next
 * tap anywhere on the page unlocks it.
 */
export function useChime(): Chime {
  const [enabled, setEnabled] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);

  const ensureContext = useCallback((): AudioContext | null => {
    if (contextRef.current) return contextRef.current;
    const Ctor = audioContextClass();
    if (!Ctor) return null;
    contextRef.current = new Ctor();
    contextRef.current.onstatechange = () => setBlocked(contextRef.current?.state !== "running");
    return contextRef.current;
  }, []);

  // Restore the preference; audio stays blocked until the first tap.
  useEffect(() => {
    if (!readPreference()) return;
    setEnabled(true);
    const context = ensureContext();
    if (!context) return;
    setBlocked(context.state !== "running");
    const unlock = () => {
      void context.resume().catch(() => undefined);
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [ensureContext]);

  useEffect(
    () => () => {
      void contextRef.current?.close().catch(() => undefined);
      contextRef.current = null;
    },
    [],
  );

  const play = useCallback(() => {
    const context = contextRef.current;
    if (!enabled || !context || context.state !== "running") return;
    playTones(context);
  }, [enabled]);

  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    writePreference(next);
    if (!next) return;
    const context = ensureContext();
    if (!context) return;
    // Inside the click handler: allowed to start audio. Play once so staff hear what to expect.
    void context.resume().then(
      () => {
        setBlocked(false);
        playTones(context);
      },
      () => setBlocked(true),
    );
  }, [enabled, ensureContext]);

  return { enabled, blocked, toggle, play };
}
