import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useMemo, type ReactNode } from "react";

export const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "";
export const CLERK_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

/** Both public keys are baked in at build time (EXPO_PUBLIC_*); missing ones surface on the sign-in screen. */
export function configProblems(): string[] {
  const problems: string[] = [];
  if (!CONVEX_URL) problems.push("EXPO_PUBLIC_CONVEX_URL is not set.");
  if (!CLERK_PUBLISHABLE_KEY) problems.push("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is not set.");
  return problems;
}

export function AuthAndDataProvider({ children }: { children: ReactNode }) {
  const client = useMemo(
    () =>
      new ConvexReactClient(CONVEX_URL || "https://unconfigured.convex.cloud", {
        unsavedChangesWarning: false,
      }),
    [],
  );
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY || "pk_test_unconfigured"}
      tokenCache={tokenCache}
    >
      <ConvexProviderWithClerk client={client} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
