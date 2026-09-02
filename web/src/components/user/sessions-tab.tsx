"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SessionRow } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { SectionCard } from "@/components/primitives/section-card";
import { SectionErrorBoundary } from "@/components/primitives/section-error-boundary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompact, formatDateTime, formatDurationMs, formatInt, formatPercent, formatUsd } from "@/lib/format";
import { sourceLabel } from "@/lib/sessions";

const PAGE_SIZE = 20;

function SessionsTable({ userId }: { userId: Id<"users"> }) {
  const { results, status, loadMore } = usePaginatedQuery(api.sessions.listRecent, { userId }, { initialNumItems: PAGE_SIZE });
  const columns: Column<SessionRow>[] = [
    {
      key: "started",
      header: "Started",
      render: (s) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {s.inProgress ? <span className="inline-block size-1.5 rounded-full bg-status-good" title="In progress" aria-label="In progress" /> : null}
          {formatDateTime(s.startedAt)}
        </span>
      ),
    },
    { key: "project", header: "Project", render: (s) => s.project },
    { key: "branch", header: "Branch", render: (s) => s.gitBranch ?? "—" },
    { key: "model", header: "Model", render: (s) => s.model },
    { key: "effort", header: "Effort", render: (s) => s.effort ?? "—" },
    { key: "turns", header: "Turns", align: "right", render: (s) => formatInt(s.turns) },
    { key: "tokens", header: "Tokens", align: "right", render: (s) => formatCompact(s.tokens.total) },
    { key: "cache", header: "Cache hit", align: "right", render: (s) => formatPercent(s.cacheHitRate) },
    { key: "cost", header: "Cost", align: "right", render: (s) => (s.costUsd === null ? "unpriced" : formatUsd(s.costUsd)) },
    { key: "active", header: "Active", align: "right", render: (s) => formatDurationMs(s.activeMs) },
    {
      key: "source",
      header: "Source",
      render: (s) => (
        <Badge variant="outline" className="rounded-full text-[10px]">
          {sourceLabel(s.source, s.isSubagent)}
        </Badge>
      ),
    },
  ];
  return (
    <SectionCard title="Sessions" description="Newest first, independent of the selected range." help="One row per Codex thread. Cost is estimated with the session's primary model." bodyClassName="flex flex-col gap-3">
      {status === "LoadingFirstPage" ? (
        <Skeleton className="h-48" />
      ) : results.length === 0 ? (
        <EmptyState title="No sessions yet" />
      ) : (
        <>
          <DataTable columns={columns} rows={results} rowKey={(s) => s.sessionId} />
          {status === "CanLoadMore" || status === "LoadingMore" ? (
            <Button variant="outline" size="sm" className="self-center" disabled={status === "LoadingMore"} onClick={() => loadMore(PAGE_SIZE)}>
              {status === "LoadingMore" ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}

export function SessionsTab({ userId }: { userId: Id<"users"> }) {
  return (
    <SectionErrorBoundary title="Sessions could not load">
      <SessionsTable userId={userId} />
    </SectionErrorBoundary>
  );
}
