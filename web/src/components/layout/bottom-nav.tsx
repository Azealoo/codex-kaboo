"use client";

import { BarChart3, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRangeHref } from "@/hooks/use-range";
import { cn } from "@/lib/utils";
import { useCurrentUserId } from "./current-user";

/**
 * Phone navigation: a fixed tab bar at the bottom, where thumbs are. Hidden from `md` up, where
 * `TopNav` shows the same destinations inline. Carries the range like every other nav link.
 */
export function BottomNav() {
  const pathname = usePathname();
  const userId = useCurrentUserId();
  const href = useRangeHref();
  const myPage = `/users/${userId}`;
  const items = [
    { label: "Insights", href: href("/"), active: pathname === "/", Icon: BarChart3 },
    { label: "My Page", href: href(myPage), active: pathname === myPage, Icon: UserRound },
    { label: "Settings", href: "/settings", active: pathname === "/settings", Icon: Settings },
  ];
  return (
    <nav
      aria-label="Primary (mobile)"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/80 md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {items.map(({ label, href: to, active, Icon }) => (
          <li key={label} className="flex-1">
            <Link
              href={to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
