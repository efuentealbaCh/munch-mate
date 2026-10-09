"use client";

import type { SavedAddressView, UserProfile } from "@app/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { localStore } from "@/lib/browser-storage";
import { hasSessionHint, setSessionHint } from "@/lib/customer";
import { authApi, customersApi } from "@/lib/endpoints";
import { hasCode } from "@/lib/errors";

/** The access token lives 15 minutes: re-check before ordering when the last check is older than this. */
const FRESH_MS = 10 * 60_000;

export type CustomerSessionState =
  | { status: "loading"; user: null }
  | { status: "guest"; user: null }
  | { status: "customer"; user: UserProfile };

export interface CustomerSession {
  state: CustomerSessionState;
  /** Saved addresses (only when asked for and signed in); null while loading, on failure, or for guests. */
  addresses: SavedAddressView[] | null;
  /** Adds an address saved from the checkout, so the list stays current without reloading. */
  addAddress(address: SavedAddressView): void;
  /**
   * Call right before sending an order: if the access cookie may have expired, /auth/me refreshes it, so the
   * api links the order to the account (an expired cookie on a public route is ignored: guest order).
   * Never throws.
   */
  ensureFresh(): Promise<void>;
}

/**
 * The visitor's account on the public pages (menu, table, tracking), without the AuthProvider: only asks
 * /api/auth/me when this browser had a session before (see SESSION_HINT_KEY). Any failure counts as a guest:
 * an account is a convenience, never a reason to block ordering.
 */
export function useCustomerSession({ addresses: wantAddresses = false }: { addresses?: boolean } = {}): CustomerSession {
  const [state, setState] = useState<CustomerSessionState>({ status: "loading", user: null });
  const [addresses, setAddresses] = useState<SavedAddressView[] | null>(null);
  const checkedAt = useRef(0);

  useEffect(() => {
    if (!hasSessionHint(localStore())) {
      setState({ status: "guest", user: null });
      return;
    }
    let current = true;
    authApi.me().then(
      (user) => {
        checkedAt.current = Date.now();
        if (current) setState({ status: "customer", user });
      },
      (error: unknown) => {
        // The session ended (logout elsewhere, expired): stop asking on every visit.
        if (hasCode(error, "UNAUTHENTICATED", "INVALID_SESSION")) setSessionHint(localStore(), false);
        if (current) setState({ status: "guest", user: null });
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const signedIn = state.status === "customer";
  useEffect(() => {
    if (!signedIn || !wantAddresses) return;
    let current = true;
    customersApi.addresses().then(
      (list) => current && setAddresses(list),
      // Without the list the checkout works as for a guest.
      () => current && setAddresses(null),
    );
    return () => {
      current = false;
    };
  }, [signedIn, wantAddresses]);

  const addAddress = useCallback((address: SavedAddressView) => {
    setAddresses((list) => (list ? [...list.filter((a) => a.id !== address.id), address] : [address]));
  }, []);

  const ensureFresh = useCallback(async () => {
    if (!signedIn || Date.now() - checkedAt.current < FRESH_MS) return;
    try {
      await authApi.me();
      checkedAt.current = Date.now();
    } catch {
      // The order goes out as a guest order; it still works through its tracking link.
    }
  }, [signedIn]);

  return { state, addresses, addAddress, ensureFresh };
}
