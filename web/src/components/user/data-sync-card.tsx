"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { MachineRow } from "@convex/lib/types";
import { CopyBox } from "@/components/primitives/copy-box";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { SectionCard } from "@/components/primitives/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNow } from "@/hooks/use-now";
import { useOrigin } from "@/hooks/use-origin";
import { formatRelative } from "@shared/format";
import { installCommands, isNewerThanTested, TESTED_CODEX_VERSION } from "@/lib/install";

export function DataSyncCard({ userId, isMe }: { userId: Id<"users">; isMe: boolean }) {
  const machines = useQuery(api.machines.list, { userId });
  const origin = useOrigin();
  const now = useNow();
  const c = installCommands(origin ?? "https://<this dashboard>");
  const columns: Column<MachineRow>[] = [
    { key: "label", header: "Machine", render: (m) => m.label },
    {
      key: "platform",
      header: "Platform",
      render: (m) => `${m.platform}${m.arch ? ` · ${m.arch}` : ""}`,
    },
    {
      key: "codex",
      header: "Codex",
      render: (m) => (
        <span className="inline-flex items-center gap-1.5">
          {m.codexVersion ?? "—"}
          {isNewerThanTested(m.codexVersion) ? (
            <Badge
              variant="outline"
              className="rounded-full text-[10px]"
              title={`Newer than the parser was tested with (${TESTED_CODEX_VERSION})`}
            >
              untested version
            </Badge>
          ) : null}
        </span>
      ),
    },
    { key: "cli", header: "Collector", render: (m) => m.cliVersion },
    {
      key: "sync",
      header: "Last sync",
      align: "right",
      render: (m) => (now === null ? "—" : formatRelative(m.lastSyncAt, now)),
    },
  ];
  return (
    <SectionCard
      title="Data Sync"
      description={
        isMe
          ? "Machines syncing for your account, and how to add one."
          : "Machines syncing for this account."
      }
      actions={
        isMe ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/settings">Manage tokens</Link>
          </Button>
        ) : undefined
      }
      bodyClassName="flex flex-col gap-4"
    >
      {machines === undefined ? (
        <Skeleton className="h-24" />
      ) : machines.length === 0 ? (
        <EmptyState
          title="No machines yet"
          description={
            isMe
              ? "Run the commands below on a machine where you use Codex."
              : "This user has not synced yet."
          }
        />
      ) : (
        <DataTable columns={columns} rows={machines} rowKey={(m) => m.machineId} />
      )}
      {isMe ? (
        <div className="grid gap-2 md:grid-cols-2">
          <CopyBox label="Install" value={c.install} />
          <CopyBox label="Log in" value={c.login} />
          <CopyBox label="Schedule" value={c.schedule} />
          <CopyBox label="Status" value={c.status} />
        </div>
      ) : null}
    </SectionCard>
  );
}
