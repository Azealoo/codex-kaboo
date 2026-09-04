import { render, screen } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/users/u1" }));
vi.mock("./current-user", () => ({ useCurrentUserId: () => "u1" as Id<"users"> }));

import { BottomNav } from "./bottom-nav";

describe("BottomNav", () => {
  it("carries the range on the dashboard links and marks the active tab", () => {
    render(<BottomNav />, { wrapper: withNuqsTestingAdapter({ searchParams: "?range=90D" }) });
    expect(screen.getByRole("link", { name: "Insights" })).toHaveAttribute("href", "/?range=90D");
    const myPage = screen.getByRole("link", { name: "My Page" });
    expect(myPage).toHaveAttribute("href", "/users/u1?range=90D");
    expect(myPage).toHaveAttribute("aria-current", "page");
    // Settings has no range of its own, so its link stays clean.
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });
});
