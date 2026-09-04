"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRangeHref } from "@/hooks/use-range";
import { cn } from "@/lib/utils";
import { useCurrentUserId } from "./current-user";
import { RangePicker } from "./range-picker";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function TopNav() {
  const pathname = usePathname();
  const userId = useCurrentUserId();
  const href = useRangeHref();
  const myPage = `/users/${userId}`;
  const links = [
    { label: "Insights", href: href("/"), active: pathname === "/" },
    { label: "My Page", href: href(myPage), active: pathname === myPage },
  ];
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-card">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-3 sm:px-4 md:gap-4 md:px-6">
        <Link href={href("/")} className="flex items-center gap-2 text-sm font-semibold">
          <span className="inline-block size-2.5 rounded-full bg-primary" aria-hidden="true" />
          codex-kaboo
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              aria-current={l.active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                l.active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <RangePicker />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

export function TopNavFallback() {
  return <header className="h-14 border-b border-border bg-card" aria-hidden="true" />;
}
