"use client";

import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";

export interface ApiQuery<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** Runs the loader again (keeps the current data visible while loading). */
  reload(): void;
  /** Local update after a mutation, without refetching. */
  setData: Dispatch<SetStateAction<T | undefined>>;
}

/**
 * Minimal data loader for client pages: runs `load` on mount and whenever it changes, ignoring
 * responses that arrive after a newer run started.
 * @param load Memoized loader (wrap it in useCallback with its real dependencies).
 */
export function useApiQuery<T>(load: () => Promise<T>): ApiQuery<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    load().then(
      (result) => {
        if (!current) return;
        setData(result);
        setError(null);
        setLoading(false);
      },
      (failure: unknown) => {
        if (!current) return;
        setError(failure);
        setLoading(false);
      },
    );
    return () => {
      current = false;
    };
  }, [load, run]);

  const reload = useCallback(() => setRun((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}
