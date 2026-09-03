"use client";

import { useCallback, useState } from "react";

export type AsyncAction<TArgs extends unknown[]> = {
  /** Runs `fn`; never rejects — a failure lands in `error` instead. */
  run: (...args: TArgs) => Promise<void>;
  pending: boolean;
  error: string | null;
  reset: () => void;
};

/**
 * Wraps a Convex mutation/action (or any promise-returning call) so the UI can render its
 * failure. Put success side effects inside `fn` — they only run when `fn` resolves.
 */
export function useAsyncAction<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<unknown>,
): AsyncAction<TArgs> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: TArgs) => {
      setPending(true);
      setError(null);
      try {
        await fn(...args);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPending(false);
      }
    },
    [fn],
  );

  const reset = useCallback(() => setError(null), []);

  return { run, pending, error, reset };
}
