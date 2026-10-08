"use client";

import type { OrderItemInput } from "@app/types";
import { useEffect, useReducer, useRef, useState } from "react";
import { sessionStore } from "@/lib/browser-storage";
import {
  cartReducer,
  type CheckoutAttempt,
  checkoutFingerprint,
  loadCart,
  loadCheckoutAttempt,
  newClientOrderId,
  pickClientOrderId,
  saveCart,
  saveCheckoutAttempt,
} from "@/lib/cart";

/**
 * Customer cart kept in sessionStorage (survives a reload, not a closed tab) plus the idempotent submission
 * id. Shared by the table page (/m/[token]) and the pickup menu (/r/[slug]).
 * @param scope Storage scope: the table code, or `pickupCartScope(slug)`.
 */
export function useStoredCart(scope: string) {
  const [lines, dispatch] = useReducer(cartReducer, []);
  const [hydrated, setHydrated] = useState(false);
  const attempt = useRef<CheckoutAttempt | null>(null);

  // Restore after hydration (the server render has no access to sessionStorage).
  useEffect(() => {
    dispatch({ type: "replace", lines: loadCart(sessionStore(), scope) });
    attempt.current = loadCheckoutAttempt(sessionStore(), scope);
    setHydrated(true);
  }, [scope]);

  useEffect(() => {
    if (hydrated) saveCart(sessionStore(), scope, lines);
  }, [hydrated, lines, scope]);

  /**
   * `clientOrderId` for a submission: the same content as a failed attempt reuses its id, so the api returns
   * that order instead of creating a duplicate.
   */
  function beginAttempt(content: {
    items: OrderItemInput[];
    customerName?: string;
    note?: string;
    customerPhone?: string;
    customerEmail?: string;
  }): string {
    attempt.current = pickClientOrderId(attempt.current, checkoutFingerprint(content), () => newClientOrderId());
    saveCheckoutAttempt(sessionStore(), scope, attempt.current);
    return attempt.current.clientOrderId;
  }

  /** After a successful order: empty cart, and the next submission gets a new id. */
  function completeOrder() {
    attempt.current = null;
    saveCheckoutAttempt(sessionStore(), scope, null);
    dispatch({ type: "clear" });
    saveCart(sessionStore(), scope, []);
  }

  return { lines, dispatch, beginAttempt, completeOrder };
}
