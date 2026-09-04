"use client";

import { usePaginatedQuery } from "convex/react";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SessionRow } from "@convex/lib/types";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { SectionCard } from "@/components/primitives/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { sourceLabel } from "@/lib/breakdowns";
import { csvFilename } from "@/lib/csv";
import {
  EM_DASH,
  formatCompact,
  formatDateTime,
  formatDurationMs,
  formatInt,
  formatPercent,
  formatUsd,
} from "@/lib/format";
import { filterSessions } from "@/lib/sessions-filter";
import { SessionDetailDialog } from "./session-detail-dialog";

const PAGE_SIZE = 20;

/**
 * Newest-first session list with a free-text filter and a click-to-open detail dialog. Team-wide
 * when `userId` is omitted (then the row shows who ran it), one person's when given. The filter is
 * applied to the pages already loaded: the list is paginated by the server and this is a "find the
 * one I mean" tool, not a search index — "Load more" keeps fetching the unfiltered stream.
 */
export function SessionsTable({
  userId,
  title = "Sessions",
  description = "Newest first, independent of the selected range.",
}: {
  userId?: Id<"users">;
  title?: string;
  description?: string;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.sessions.listRecent,
    userId === undefined ? {} : { userId },
    { initialNumItems: PAGE_SIZE },
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const showUser = userId === undefined;
  const filtered = useMemo(() => filterSessions(results, query), [results, query]);

  const columns: Column<SessionRow>[] = [
    {
      key: "started",
      header: "Started",
      csv: (s) => new Date(s.startedAt).toISOString(),
      render: (s) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {s.inProgress ? (
            <span
              className="inline-block size-1.5 rounded-full bg-status-good"
              title="In progress"
              aria-label="In progress"
            />
          ) : null}
          {formatDateTime(s.startedAt)}
        </span>
      ),
    },
    ...(showUser
      ? [
          {
            key: "user",
            header: "User",
            render: (s: SessionRow) => s.userName,
          } as Column<SessionRow>,
        ]
      : []),
    { key: "project", header: "Project", render: (s) => s.project },
    { key: "branch", header: "Branch", hideBelow: "lg", render: (s) => s.gitBranch ?? EM_DASH },
    { key: "model", header: "Model", hideBelow: "sm", render: (s) => s.model },
    { key: "effort", header: "Effort", hideBelow: "lg", render: (s) => s.effort ?? EM_DASH },
    {
      key: "turns",
      header: "Turns",
      align: "right",
      hideBelow: "md",
      render: (s) => formatInt(s.turns),
    },
    {
      key: "tokens",
      header: "Tokens",
      align: "right",
      csv: (s) => s.tokens.total,
      render: (s) => formatCompact(s.tokens.total),
    },
    {
      key: "cache",
      header: "Cache hit",
      align: "right",
      hideBelow: "md",
      csv: (s) => s.cacheHitRate,
      render: (s) => formatPercent(s.cacheHitRate),
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      csv: (s) => s.costUsd,
      render: (s) => (s.costUsd === null ? "unpriced" : formatUsd(s.costUsd)),
    },
    {
      key: "active",
      header: "Active",
      align: "right",
      hideBelow: "lg",
      csv: (s) => s.activeMs,
      render: (s) => formatDurationMs(s.activeMs),
    },
    {
      key: "source",
      header: "Source",
      hideBelow: "md",
      csv: (s) => sourceLabel(s.source, s.isSubagent),
      render: (s) => (
        <Badge variant="outline" className="rounded-full text-[10px]">
          {sourceLabel(s.source, s.isSubagent)}
        </Badge>
      ),
    },
  ];

  const loading = status === "LoadingFirstPage";
  return (
    <SectionCard
      title={title}
      description={description}
      help="One row per Codex thread. Cost is estimated with the session's primary model. Click a row for the full breakdown."
      actions={
        <label className="relative block w-full sm:w-56">
          <Search
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter project, branch, model…"
            aria-label="Filter sessions"
            className="h-8 pl-7 text-xs"
            disabled={loading}
          />
        </label>
      }
      bodyClassName="flex flex-col gap-3"
    >
      {loading ? (
        <Skeleton className="h-48" />
      ) : results.length === 0 ? (
        <EmptyState title="No sessions yet" />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(s) => s.sessionId}
            onRowClick={setSelected}
            rowLabel={(s) => `${s.project}, ${formatDateTime(s.startedAt)}`}
            emptyLabel={`No loaded session matches “${query.trim()}”`}
            exportFilename={csvFilename(title)}
          />
          {query.trim() !== "" ? (
            <p className="text-xs text-muted-foreground" role="status">
              {formatInt(filtered.length)} of {formatInt(results.length)} loaded sessions match.
            </p>
          ) : null}
          {status === "CanLoadMore" || status === "LoadingMore" ? (
            <Button
              variant="outline"
              size="sm"
              className="self-center"
              disabled={status === "LoadingMore"}
              onClick={() => loadMore(PAGE_SIZE)}
            >
              {status === "LoadingMore" ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </>
      )}
      <SessionDetailDialog
        session={selected}
        onClose={() => setSelected(null)}
        showUser={showUser}
      />
    </SectionCard>
  );
}
