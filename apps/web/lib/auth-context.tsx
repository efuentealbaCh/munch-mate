"use client";

import type { UserProfile } from "@app/types";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { authApi } from "./endpoints";
import { hasCode } from "./errors";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

interface AuthContextValue {
  status: AuthStatus;
  user: UserProfile | null;
  /** Stores the profile returned by login/register (or null after logout). */
  setUser(user: UserProfile | null): void;
  /** Loads GET /auth/me again (e.g. after a network error). */
  reloadProfile(): Promise<void>;
  /**
   * Rotates the session and stores the fresh profile. Needed after verifying the email or accepting an
   * invitation: the access token's claims are stale until the next refresh.
   */
  syncSession(): Promise<UserProfile | null>;
  /** Ends the session on the server and locally. @throws ApiError when the request fails. */
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the logged-in user for the whole app. The session lives in httpOnly cookies the JS cannot read,
 * so the only way to know whether there is one is asking the api (GET /auth/me, which refreshes on 401).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUserState] = useState<UserProfile | null>(null);

  const setUser = useCallback((next: UserProfile | null) => {
    setUserState(next);
    setStatus(next ? "authenticated" : "unauthenticated");
  }, []);

  const reloadProfile = useCallback(async () => {
    try {
      setUser(await authApi.me());
    } catch (error) {
      if (hasCode(error, "UNAUTHENTICATED", "INVALID_SESSION")) {
        setUser(null);
      } else {
        setUserState(null);
        setStatus("error");
      }
    }
  }, [setUser]);

  const syncSession = useCallback(async () => {
    const profile = await api.refreshSession();
    setUser(profile);
    return profile;
  }, [setUser]);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, [setUser]);

  useEffect(() => {
    void reloadProfile();
    return api.onSessionExpired(() => setUser(null));
  }, [reloadProfile, setUser]);

  const value = useMemo(
    () => ({ status, user, setUser, reloadProfile, syncSession, logout }),
    [status, user, setUser, reloadProfile, syncSession, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** @throws Error when used outside {@link AuthProvider}. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
