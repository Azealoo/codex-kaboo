"use client";

import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/primitives/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useEnsureUser } from "@/hooks/use-ensure-user";
import { CurrentUserProvider } from "./current-user";

export function ShellSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6" aria-busy="true">
      <Skeleton className="mb-6 h-10 w-full" />
      <div className="grid gap-4 md:grid-cols-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="mt-6 h-72 w-full" />
    </div>
  );
}

function EnsuredUser({ children }: { children: ReactNode }) {
  const { ready, error, retry } = useEnsureUser();
  if (error !== null) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        <EmptyState
          title="Could not load your account"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={retry}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }
  if (ready === null) return <ShellSkeleton />;
  return <CurrentUserProvider userId={ready}>{children}</CurrentUserProvider>;
}

/** Renders children only for a signed-in user whose Convex `users` row exists. */
export function AppGate({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <ShellSkeleton />
      </AuthLoading>
      <Unauthenticated>
        <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-muted-foreground">You are signed out.</p>
          <Link href="/sign-in" className="text-sm font-medium text-primary underline">
            Sign in
          </Link>
        </main>
      </Unauthenticated>
      <Authenticated>
        <EnsuredUser>{children}</EnsuredUser>
      </Authenticated>
    </>
  );
}
