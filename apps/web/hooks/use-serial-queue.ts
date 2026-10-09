"use client";

import { useCallback, useRef } from "react";

/**
 * Runs async tasks one after another, in call order. Used for optimistic reorders: each request carries
 * the full order computed at click time, so running them in sequence guarantees the server ends with the
 * order of the last click even when the owner taps quickly.
 * @returns `enqueue(task)`, resolving/rejecting with the task's own result.
 */
export function useSerialQueue() {
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  return useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.current.then(task, task);
    tail.current = run.catch(() => undefined);
    return run;
  }, []);
}
