"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAsyncAction } from "@/hooks/use-async-action";
import { InlineError } from "./inline-error";

export function CopyBox({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  // `writeText` rejects in an insecure context or when the permission is denied — show that.
  const copy = useAsyncAction(async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  });
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="flex flex-col gap-1">
      {label ? <span className="text-xs text-muted-foreground">{label}</span> : null}
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={copied ? "Copied" : "Copy"}
          onClick={() => void copy.run()}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </Button>
      </div>
      <InlineError message={copy.error} />
    </div>
  );
}
