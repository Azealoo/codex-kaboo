"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { useCurrentUserId } from "@/components/layout/current-user";
import { CopyBox } from "@/components/primitives/copy-box";
import { SectionCard } from "@/components/primitives/section-card";
import { Button } from "@/components/ui/button";
import { useOrigin } from "@/hooks/use-origin";
import { installCommands } from "@/lib/install";

/** Shown until the signed-in user has synced from at least one machine. */
export function OnboardingCard() {
  const userId = useCurrentUserId();
  const machines = useQuery(api.machines.list, { userId });
  const origin = useOrigin();
  if (machines === undefined || machines.length > 0) return null;
  const c = installCommands(origin ?? "https://<this dashboard>");
  return (
    <SectionCard
      title="Install the collector"
      description="No machine has synced for your account yet. Run these four commands on each machine where you use Codex."
      actions={
        <Button asChild variant="outline" size="sm">
          <Link href="/settings">Create a sync token</Link>
        </Button>
      }
      bodyClassName="grid gap-2 md:grid-cols-2"
    >
      <CopyBox label="1. Install" value={c.install} />
      <CopyBox label="2. Log in (paste your token)" value={c.login} />
      <CopyBox label="3. Schedule background sync" value={c.schedule} />
      <CopyBox label="4. Check" value={c.status} />
    </SectionCard>
  );
}
