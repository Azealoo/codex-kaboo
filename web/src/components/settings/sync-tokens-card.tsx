"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { SyncTokenRow } from "@convex/lib/types";
import { CopyBox } from "@/components/primitives/copy-box";
import { DataTable, type Column } from "@/components/primitives/data-table";
import { EmptyState } from "@/components/primitives/empty-state";
import { InlineError } from "@/components/primitives/inline-error";
import { SectionCard } from "@/components/primitives/section-card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAsyncAction } from "@/hooks/use-async-action";
import { useNow } from "@/hooks/use-now";
import { useOrigin } from "@/hooks/use-origin";
import { EM_DASH, formatDateTime, formatRelative } from "@/lib/format";
import { installCommands } from "@/lib/install";

type Created = { token: string; prefix: string; name: string };

function NewTokenDialog() {
  const create = useAction(api.syncTokens.create);
  const origin = useOrigin();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("My machine");
  // The raw token lives here — in this dialog's own React state — for the life of the dialog,
  // and nowhere else (never localStorage, a URL, a query param, a log or an analytics call).
  const [created, setCreated] = useState<Created | null>(null);

  const submit = useAsyncAction(async () => {
    const label = name.trim() || "My machine";
    const result = await create({ name: label });
    setCreated({ token: result.token, prefix: result.prefix, name: label });
  });

  const reset = () => {
    setName("My machine");
    setCreated(null);
    submit.reset();
  };

  const commands = installCommands(origin ?? "https://<this dashboard>", created?.token);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">New token</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {created ? `Token "${created.name}" created` : "New sync token"}
          </DialogTitle>
          <DialogDescription>
            {created
              ? "Copy it now — it is shown only once. Anyone with this token can upload usage to your account."
              : "One token per machine keeps revocation simple. The name is only a label."}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="flex flex-col gap-3">
            <CopyBox label="Token" value={created.token} />
            <CopyBox
              label="Run on the machine after installing the collector"
              value={commands.login}
            />
            <CopyBox label="Install (if not installed yet)" value={commands.install} />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="token-name">Token name</Label>
            <Input
              id="token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
            />
            <InlineError message={submit.error} />
          </div>
        )}
        <DialogFooter>
          {created ? (
            <Button
              onClick={() => {
                // This directly assigns the controlled `open` prop, which does not itself run
                // through Radix's `onOpenChange` — so the raw token's state is cleared explicitly
                // here too, not only on Radix-driven close paths (Escape, overlay click).
                setOpen(false);
                reset();
              }}
            >
              Done
            </Button>
          ) : (
            <Button onClick={() => void submit.run()} disabled={submit.pending}>
              {submit.pending ? "Creating…" : "Create token"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeButton({ token }: { token: SyncTokenRow }) {
  const revokeToken = useMutation(api.syncTokens.revoke);
  const revoke = useAsyncAction(revokeToken);
  if (token.revokedAt !== null) return null;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-destructive">
            Revoke
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* Named by both name and prefix, so muscle memory can't revoke the wrong token when
                two machines share a label. */}
            <AlertDialogTitle>
              Revoke “{token.name}” ({token.prefix}…)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Machines using “{token.name}” ({token.prefix}…) stop syncing immediately (their next
              sync gets 401). Already uploaded data is kept. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoke.pending}
              onClick={() => void revoke.run({ tokenId: token._id })}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* The dialog closes immediately on click (Radix's default Action behaviour), so a failure
          is rendered next to the row instead of inside the now-closed dialog. */}
      <InlineError message={revoke.error} />
    </span>
  );
}

export function SyncTokensCard() {
  const tokens = useQuery(api.syncTokens.list, {});
  const now = useNow();
  const columns: Column<SyncTokenRow>[] = [
    { key: "name", header: "Name", render: (t) => t.name },
    {
      key: "prefix",
      header: "Token",
      render: (t) => <code className="font-mono text-xs">{t.prefix}…</code>,
    },
    { key: "created", header: "Created", render: (t) => formatDateTime(t.createdAt) },
    {
      key: "used",
      header: "Last used",
      render: (t) =>
        now === null
          ? EM_DASH
          : t.lastUsedAt === null
            ? "never"
            : formatRelative(t.lastUsedAt, now),
    },
    {
      key: "status",
      header: "Status",
      render: (t) =>
        t.revokedAt === null ? (
          <Badge className="rounded-full bg-delta-up-bg text-delta-up-fg">Active</Badge>
        ) : (
          <Badge variant="outline" className="rounded-full">
            Revoked
          </Badge>
        ),
    },
    { key: "actions", header: "", align: "right", render: (t) => <RevokeButton token={t} /> },
  ];
  return (
    <SectionCard
      title="Sync tokens"
      description="The collector authenticates with a token. Only the hash is stored; the raw value is shown once at creation."
      actions={<NewTokenDialog />}
    >
      {tokens === undefined ? (
        <Skeleton className="h-24" />
      ) : tokens.length === 0 ? (
        <EmptyState
          title="No tokens yet"
          description="Create one, then run the install commands on your machine."
        />
      ) : (
        <DataTable columns={columns} rows={tokens} rowKey={(t) => t._id} />
      )}
    </SectionCard>
  );
}
