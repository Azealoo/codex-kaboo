"use client";

import { MAX_QUERY_RANGE_DAYS } from "@shared/constants";
import { addDays } from "@shared/days";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { PriceRow } from "@convex/lib/types";
import { EmptyState } from "@/components/primitives/empty-state";
import { InlineError } from "@/components/primitives/inline-error";
import { SectionCard } from "@/components/primitives/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAsyncAction } from "@/hooks/use-async-action";
import { useStableQuery } from "@/hooks/use-stable-query";
import { useToday } from "@/hooks/use-today";
import { parsePrice } from "@/lib/prices";

type Draft = { model: string; input: string; cached: string; output: string };

function PriceEditor({
  draft,
  onChange,
  onSave,
  onRemove,
  removeLabel = "Remove",
  modelEditable,
  error,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  onSave: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  modelEditable: boolean;
  error: string | null;
}) {
  const input = parsePrice(draft.input);
  const cached = parsePrice(draft.cached);
  const output = parsePrice(draft.output);
  const valid =
    draft.model.trim().length > 0 && input !== null && cached !== null && output !== null;
  const field = (key: "input" | "cached" | "output", label: string) => (
    <TableCell className="text-right">
      <Input
        inputMode="decimal"
        aria-label={`${label} price for ${draft.model || "new model"}`}
        value={draft[key]}
        onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
        className="h-8 w-24 text-right font-mono tabular"
        aria-invalid={parsePrice(draft[key]) === null}
      />
    </TableCell>
  );
  return (
    <TableRow>
      <TableCell>
        {modelEditable ? (
          <Input
            aria-label="Model name"
            placeholder="model name"
            value={draft.model}
            onChange={(e) => onChange({ ...draft, model: e.target.value })}
            className="h-8 w-48 font-mono"
          />
        ) : (
          <code className="font-mono text-xs">{draft.model}</code>
        )}
      </TableCell>
      {field("input", "Input")}
      {field("cached", "Cached input")}
      {field("output", "Output")}
      <TableCell className="text-right whitespace-nowrap">
        <div className="inline-flex flex-col items-end gap-1">
          <span className="inline-flex gap-1">
            <Button size="sm" disabled={!valid} onClick={onSave}>
              Save
            </Button>
            {onRemove ? (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
                {removeLabel}
              </Button>
            ) : null}
          </span>
          <InlineError message={error} />
        </div>
      </TableCell>
    </TableRow>
  );
}

/** The "add a model" row: it owns its own `useAsyncAction`, matching `RenameCell`'s pattern in
 * `machines-card.tsx`, so its pending/error state can never be shared with an existing price row. */
function AddedPriceRow({
  draft,
  onChange,
  onCancel,
  onAdded,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const upsert = useMutation(api.prices.upsert);
  const save = useAsyncAction(async (d: Draft) => {
    await upsert({
      model: d.model.trim(),
      inputUsdPerMTok: parsePrice(d.input)!,
      cachedInputUsdPerMTok: parsePrice(d.cached)!,
      outputUsdPerMTok: parsePrice(d.output)!,
    });
    onAdded();
  });
  return (
    <PriceEditor
      draft={draft}
      onChange={onChange}
      onSave={() => void save.run(draft)}
      onRemove={onCancel}
      removeLabel="Cancel"
      modelEditable
      error={save.error}
    />
  );
}

/** One existing price row. Owns its own `useAsyncAction` for both save and remove, matching
 * `RenameCell`'s pattern — a row's pending/error state must never leak into a sibling row's. */
function ExistingPriceRow({
  price,
  draft,
  onChange,
  onSaved,
}: {
  price: PriceRow;
  draft: Draft;
  onChange: (next: Draft) => void;
  onSaved: () => void;
}) {
  const upsert = useMutation(api.prices.upsert);
  const removePrice = useMutation(api.prices.remove);
  const save = useAsyncAction(async (d: Draft) => {
    await upsert({
      model: d.model.trim(),
      inputUsdPerMTok: parsePrice(d.input)!,
      cachedInputUsdPerMTok: parsePrice(d.cached)!,
      outputUsdPerMTok: parsePrice(d.output)!,
    });
    onSaved();
  });
  const remove = useAsyncAction(removePrice);
  return (
    <PriceEditor
      draft={draft}
      modelEditable={false}
      onChange={onChange}
      onSave={() => void save.run(draft)}
      onRemove={() => void remove.run({ model: price.model })}
      error={save.error ?? remove.error}
    />
  );
}

function toDraft(p: PriceRow): Draft {
  return {
    model: p.model,
    input: String(p.inputUsdPerMTok),
    cached: String(p.cachedInputUsdPerMTok),
    output: String(p.outputUsdPerMTok),
  };
}

export function PricesCard() {
  const prices = useQuery(api.prices.list, {});
  const today = useToday();
  // The server already reports which models had tokens but no price row (contracts §9), so this
  // is a summary over the widest legal window, not the far heavier `stats.breakdowns`.
  const { data: seen } = useStableQuery(
    api.stats.summary,
    today
      ? { from: addDays(today, -(MAX_QUERY_RANGE_DAYS - 1)), to: today, previous: false }
      : "skip",
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [added, setAdded] = useState<Draft | null>(null);

  const unpriced = seen ? [...seen.unpricedModels].sort() : [];

  return (
    <SectionCard
      title="Model prices"
      description="USD per million tokens (input, cached input, output). Reasoning tokens are billed as output. Edits re-price every visible period instantly."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdded({ model: "", input: "", cached: "", output: "" })}
          disabled={added !== null}
        >
          Add model
        </Button>
      }
      bodyClassName="flex flex-col gap-3"
    >
      {unpriced.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Unpriced models seen:
          {unpriced.map((m) => (
            <Button
              key={m}
              size="sm"
              variant="outline"
              className="h-7 rounded-full"
              // Disabled while a draft is open so a stray click can't silently discard it — the
              // draft's own Remove/cancel button clears that state first.
              disabled={added !== null}
              onClick={() => setAdded({ model: m, input: "", cached: "", output: "" })}
            >
              <Badge variant="secondary" className="rounded-full font-mono text-[10px]">
                {m}
              </Badge>
              add price
            </Button>
          ))}
        </div>
      ) : null}
      {prices === undefined ? (
        <Skeleton className="h-40" />
      ) : prices.length === 0 && added === null ? (
        <EmptyState
          title="No prices yet"
          description="Run `npx convex run prices:seed` or add models here."
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Cached input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {added ? (
                <AddedPriceRow
                  draft={added}
                  onChange={setAdded}
                  // Otherwise starting "Add model" is a dead end: the header button is disabled
                  // while a draft is open, and there is no other way to back out of it.
                  onCancel={() => setAdded(null)}
                  onAdded={() => setAdded(null)}
                />
              ) : null}
              {prices.map((p) => {
                const draft = drafts[p.model] ?? toDraft(p);
                return (
                  <ExistingPriceRow
                    key={p._id}
                    price={p}
                    draft={draft}
                    onChange={(next) => setDrafts((d) => ({ ...d, [p.model]: next }))}
                    onSaved={() =>
                      setDrafts((d) => {
                        const next = { ...d };
                        delete next[p.model];
                        return next;
                      })
                    }
                  />
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
