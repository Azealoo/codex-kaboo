"use client";

import type { SessionRow } from "@convex/lib/types";
import { StackedShareBar } from "@/components/charts/stacked-share-bar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TOOL_LABELS, sourceLabel } from "@/lib/breakdowns";
import { CATEGORICAL } from "@/lib/colors";
import {
  EM_DASH,
  formatCompact,
  formatDateTime,
  formatDurationMs,
  formatInt,
  formatPercent,
  formatUsd,
} from "@/lib/format";
import { toolBreakdown } from "@/lib/sessions-filter";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="text-sm font-medium tabular">{value}</dd>
    </div>
  );
}

function tokenSegments(s: SessionRow) {
  const t = s.tokens;
  const uncached = Math.max(0, t.input - t.cachedInput);
  const reasoning = Math.min(t.reasoning, t.output);
  const plainOutput = Math.max(0, t.output - reasoning);
  const total = uncached + t.cachedInput + plainOutput + reasoning;
  const share = (n: number) => (total > 0 ? n / total : 0);
  return [
    {
      key: "input",
      label: "Uncached input",
      value: uncached,
      share: share(uncached),
      color: CATEGORICAL[1],
    },
    {
      key: "cached",
      label: "Cached input",
      value: t.cachedInput,
      share: share(t.cachedInput),
      color: CATEGORICAL[0],
    },
    {
      key: "output",
      label: "Output",
      value: plainOutput,
      share: share(plainOutput),
      color: CATEGORICAL[2],
    },
    {
      key: "reasoning",
      label: "Reasoning",
      value: reasoning,
      share: share(reasoning),
      color: CATEGORICAL[6],
    },
  ];
}

/**
 * Everything the session row carries, laid out for reading. Pure presentation over a `SessionRow`
 * the list already holds, so opening it costs no extra query. Never shows prompt text, commands or
 * paths — none of those exist server-side (see the README's privacy table).
 */
export function SessionDetailDialog({
  session,
  onClose,
  showUser = false,
}: {
  session: SessionRow | null;
  onClose: () => void;
  showUser?: boolean;
}) {
  const s = session;
  const tools = s ? toolBreakdown(s.toolCounts, TOOL_LABELS) : [];
  return (
    <Dialog open={s !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {s ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {s.project}
                <Badge variant="outline" className="rounded-full text-[10px]">
                  {sourceLabel(s.source, s.isSubagent)}
                </Badge>
                {s.inProgress ? (
                  <Badge className="rounded-full bg-status-good/15 text-[10px] text-foreground">
                    In progress
                  </Badge>
                ) : null}
              </DialogTitle>
              <DialogDescription>
                {formatDateTime(s.startedAt)}
                {s.gitBranch ? ` · ${s.gitBranch}` : ""}
                {showUser ? ` · ${s.userName}` : ""} · {s.machineLabel}
              </DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Model" value={s.model} />
              <Field label="Effort" value={s.effort ?? EM_DASH} />
              <Field
                label="Est. cost"
                value={
                  s.costUsd === null ? (
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      unpriced
                    </Badge>
                  ) : (
                    formatUsd(s.costUsd)
                  )
                }
              />
              <Field label="Tokens" value={formatCompact(s.tokens.total)} />
              <Field label="Cache hit" value={formatPercent(s.cacheHitRate)} />
              <Field label="Responses" value={formatInt(s.responses)} />
              <Field
                label="Turns"
                value={`${formatInt(s.completedTurns)} / ${formatInt(s.turns)} done`}
              />
              <Field
                label="Messages"
                value={`${formatInt(s.userMessages)} you · ${formatInt(s.agentMessages)} agent`}
              />
              <Field label="Reasoning items" value={formatInt(s.reasoningItems)} />
              <Field label="Active time" value={formatDurationMs(s.activeMs)} />
              <Field label="Wall time" value={formatDurationMs(s.wallMs)} />
              <Field
                label="TTFT mean"
                value={s.ttftAvgMs === null ? EM_DASH : formatDurationMs(s.ttftAvgMs)}
              />
              <Field
                label="Lines"
                value={`+${formatInt(s.linesAdded)} / −${formatInt(s.linesRemoved)}`}
              />
              <Field label="Files changed" value={formatInt(s.filesChanged)} />
              <Field label="Compactions" value={formatInt(s.compactions)} />
            </dl>

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold">Token structure</h3>
              <StackedShareBar segments={tokenSegments(s)} format={formatCompact} />
            </section>

            {tools.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold">Tools</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {tools.map((t) => (
                    <li key={t.key}>
                      <Badge variant="secondary" className="rounded-full font-normal">
                        {t.label}
                        <span className="tabular font-semibold">{formatInt(t.count)}</span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {s.mcpTools.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold">MCP tools</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {s.mcpTools.map((t) => (
                    <li key={t.key}>
                      <Badge variant="outline" className="rounded-full font-mono font-normal">
                        {t.key} <span className="tabular font-semibold">{formatInt(t.count)}</span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {s.skills.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold">Skills</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {s.skills.map((t) => (
                    <li key={t.key}>
                      <Badge variant="outline" className="rounded-full font-normal">
                        {t.key} <span className="tabular font-semibold">{formatInt(t.count)}</span>
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs sm:grid-cols-3">
              <Field label="Started via" value={s.originator} />
              <Field label="Codex" value={s.cliVersion ?? EM_DASH} />
              <Field label="Time zone" value={s.timezone ?? EM_DASH} />
              <div className="col-span-2 flex flex-col gap-0.5 sm:col-span-3">
                <dt className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  Thread
                </dt>
                <dd className="truncate font-mono text-xs" title={s.sessionId}>
                  {s.sessionId}
                  {s.parentThreadId ? ` (parent ${s.parentThreadId})` : ""}
                </dd>
              </div>
            </dl>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
