import { useConvexAuth, useMutation } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const CurrentUserContext = createContext<Id<"users"> | null>(null);

export type EnsureState = { ready: Id<"users"> | null; error: string | null; retry: () => void };

/** Calls `users.ensure` once per sign-in — the same bootstrap the web's AppGate performs. */
export function useEnsureUser(): EnsureState {
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
  if (!isAuthenticated) return { ready: null, error: null, retry };
  return { ready, error, retry };
}

export function CurrentUserProvider({
  userId,
  children,
}: {
  userId: Id<"users">;
  children: ReactNode;
}) {
  return <CurrentUserContext.Provider value={userId}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUserId(): Id<"users"> {
  const id = useContext(CurrentUserContext);
  if (id === null) throw new Error("useCurrentUserId must be used inside <CurrentUserProvider>");
  return id;
}
