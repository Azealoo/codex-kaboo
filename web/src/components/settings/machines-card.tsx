"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { MachineRow } from "@convex/lib/types";
import { useCurrentUserId } from "@/components/layout/current-user";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { InlineError } from "@/components/primitives/inline-error";
import { SectionCard } from "@/components/primitives/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsyncAction } from "@/hooks/use-async-action";
import { useNow } from "@/hooks/use-now";
import { EM_DASH, formatRelative } from "@/lib/format";
import { isNewerThanTested, TESTED_CODEX_VERSION } from "@/lib/install";

function RenameCell({ machine }: { machine: MachineRow }) {
  const renameMachine = useMutation(api.machines.rename);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(machine.label);
  const rename = useAsyncAction(async (next: string) => {
    await renameMachine({ machineId: machine.machineId, label: next });
    setEditing(false);
  });
  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        {machine.label}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // Always start from the live label, not whatever was left over from a previous
            // edit/cancel — `label` is local state that otherwise only changes via typing.
            setLabel(machine.label);
            setEditing(true);
          }}
        >
          Rename
        </Button>
      </span>
    );
  }
  return (
    <form
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const next = label.trim();
        if (next.length === 0 || next.length > 64) return;
        void rename.run(next);
      }}
    >
      <span className="inline-flex items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={64}
          className="h-8 w-40"
          aria-label="Machine label"
        />
        <Button type="submit" size="sm" disabled={rename.pending || label.trim().length === 0}>
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            rename.reset();
            setLabel(machine.label);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </span>
      <InlineError message={rename.error} />
    </form>
  );
}

export function MachinesCard() {
  const me = useCurrentUserId();
  const machines = useQuery(api.machines.list, {});
  const users = useQuery(api.users.list, {});
  const now = useNow();
  const names = new Map((users ?? []).map((u) => [u.userId as string, u.name]));
  const columns: Column<MachineRow>[] = [
    {
      key: "label",
      header: "Machine",
      render: (m) => (m.userId === me ? <RenameCell machine={m} /> : m.label),
    },
    { key: "owner", header: "Owner", render: (m) => names.get(m.userId as string) ?? EM_DASH },
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
          {m.codexVersion ?? EM_DASH}
          {m.codexLatestVersion && m.codexVersion && m.codexLatestVersion !== m.codexVersion ? (
            <span className="text-xs text-muted-foreground">(latest {m.codexLatestVersion})</span>
          ) : null}
          {isNewerThanTested(m.codexVersion) ? (
            <Badge
              variant="outline"
              className="rounded-full text-[10px]"
              title={`Parser tested with Codex ${TESTED_CODEX_VERSION}`}
            >
              untested version
            </Badge>
          ) : null}
        </span>
      ),
    },
    { key: "cli", header: "Collector", render: (m) => m.cliVersion },
    { key: "host", header: "Hostname", render: (m) => m.hostname ?? "hidden" },
    {
      key: "sync",
      header: "Last sync",
      align: "right",
      render: (m) => (now === null ? EM_DASH : formatRelative(m.lastSyncAt, now)),
    },
  ];
  return (
    <SectionCard
      title="Machines"
      description="Every machine that has synced. You can rename your own; hostnames appear only when the collector was logged in with --hostname."
    >
      {machines === undefined ? (
        <Skeleton className="h-24" />
      ) : machines.length === 0 ? (
        <EmptyState title="No machines have synced yet" />
      ) : (
        <DataTable columns={columns} rows={machines} rowKey={(m) => m.machineId} />
      )}
    </SectionCard>
  );
}
