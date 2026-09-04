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
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("./current-user", () => ({ useCurrentUserId: () => "u1" as Id<"users"> }));
vi.mock("./range-picker", () => ({ RangePicker: () => <div data-testid="range-picker" /> }));
vi.mock("./user-menu", () => ({ UserMenu: () => <div data-testid="user-menu" /> }));
vi.mock("./theme-toggle", () => ({ ThemeToggle: () => <div data-testid="theme-toggle" /> }));

import { TopNav } from "./top-nav";

describe("TopNav", () => {
  it("carries the selected range on every link and marks the active one", () => {
    render(<TopNav />, { wrapper: withNuqsTestingAdapter({ searchParams: "?range=7D" }) });
    const insights = screen.getByRole("link", { name: "Insights" });
    const myPage = screen.getByRole("link", { name: "My Page" });
    expect(insights).toHaveAttribute("href", "/?range=7D");
    expect(myPage).toHaveAttribute("href", "/users/u1?range=7D");
    expect(insights).toHaveAttribute("aria-current", "page");
    expect(myPage).not.toHaveAttribute("aria-current");
  });
});
