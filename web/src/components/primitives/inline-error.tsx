import { cn } from "@/lib/utils";

/** One red 12 px line for a failed mutation/action; renders nothing when there is no error. */
export function InlineError({ message, className }: { message: string | null; className?: string }) {
  if (message === null) return null;
  return (
    <p role="alert" className={cn("text-xs text-destructive", className)}>
      {message}
    </p>
  );
}
