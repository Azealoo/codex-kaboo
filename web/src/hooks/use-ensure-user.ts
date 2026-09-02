"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export type EnsureUserState = {
  /** The Convex user id once `users.ensure` resolved; `null` while pending or after a failure. */
  ready: Id<"users"> | null;
  /** The message of the last `users.ensure` failure, `null` when there was none. */
  error: string | null;
  /** Runs `users.ensure` again and clears the error. */
  retry: () => void;
};

/** Calls `users.ensure` once per sign-in and surfaces the id, the failure and a retry. */
export function useEnsureUser(): EnsureUserState {
  const { isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const [ready, setReady] = useState<Id<"users"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    ensure({})
      .then((id) => {
        if (cancelled) return;
        setReady(id);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, ensure, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  // Gate on `isAuthenticated` here (rather than resetting `ready`/`error` synchronously
  // inside the effect above) so a sign-out never leaks a stale id/error and so the reset
  // doesn't trigger the extra render pass `react-hooks/set-state-in-effect` warns about.
  if (!isAuthenticated) {
    return { ready: null, error: null, retry };
  }
  return { ready, error, retry };
}
