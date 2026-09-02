"use client";

import { useMe } from "@/hooks/use-me";

export default function HomePage() {
  const me = useMe();
  if (me === undefined) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return <p className="text-sm">Signed in as {me?.name ?? "unknown"}</p>;
}
