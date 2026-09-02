"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { MeResult } from "@convex/lib/types";

/** The signed-in user's Convex document; `undefined` while loading. */
export function useMe(): MeResult | null | undefined {
  return useQuery(api.users.me, {});
}
