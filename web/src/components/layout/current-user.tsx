"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Id } from "@convex/_generated/dataModel";

const CurrentUserContext = createContext<Id<"users"> | null>(null);

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
  if (id === null) {
    throw new Error("useCurrentUserId must be used inside <AppGate>");
  }
  return id;
}
