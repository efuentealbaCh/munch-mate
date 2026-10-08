"use client";

import { useCallback, useEffect, useState } from "react";
import { restaurantsApi } from "@/lib/endpoints";
import { errorMessage } from "@/lib/errors";
import { localSlugStatus, type SlugStatus, statusFromAvailability } from "@/lib/slug-field";

const DEBOUNCE_MS = 400;

/**
 * Live availability of a slug: local rules first (no request), then a debounced api check.
 * Stale answers are discarded (each check is tied to the slug it was asked for, and aborted when the slug changes).
 * @param slug Normalized slug currently in the field.
 * @param originalSlug When editing, the restaurant's current slug (reported as "unchanged").
 * @returns The status to display, and `markTaken` to apply a 409 SLUG_TAKEN from a submit.
 */
export function useSlugAvailability(slug: string, originalSlug?: string) {
  const [remote, setRemote] = useState<{ slug: string; status: SlugStatus } | null>(null);
  const local = localSlugStatus(slug, originalSlug);
  const needsRemote = local === null;

  useEffect(() => {
    if (!needsRemote) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      restaurantsApi.slugAvailability(slug.trim(), controller.signal).then(
        (availability) => setRemote({ slug, status: statusFromAvailability(availability) }),
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setRemote({ slug, status: { kind: "error", message: errorMessage(error) } });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [slug, needsRemote]);

  const markTaken = useCallback((takenSlug: string, suggestion?: string) => {
    setRemote({ slug: takenSlug, status: suggestion ? { kind: "taken", suggestion } : { kind: "taken" } });
  }, []);

  const status: SlugStatus = local ?? (remote?.slug === slug ? remote.status : { kind: "checking" });
  return { status, markTaken };
}

/** Host shown before "/r/<slug>" (public URL of the restaurant). */
export function usePublicHost(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const [host, setHost] = useState(() => (configured ? safeHost(configured) : ""));
  useEffect(() => {
    if (!host) setHost(window.location.host);
  }, [host]);
  return host;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
