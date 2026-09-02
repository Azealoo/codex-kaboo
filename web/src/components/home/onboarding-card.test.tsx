import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { installCommands } from "@/lib/install";

const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({ useQuery: (...args: unknown[]) => useQueryMock(...args) }));
vi.mock("@/components/layout/current-user", () => ({ useCurrentUserId: () => "u1" as Id<"users"> }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { OnboardingCard } from "./onboarding-card";

describe("OnboardingCard", () => {
  it("renders nothing while the machine list is loading", () => {
    useQueryMock.mockReturnValue(undefined);
    const { container } = render(<OnboardingCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once the user already has a machine", () => {
    useQueryMock.mockReturnValue([{ machineId: "m1", label: "MacBook" }]);
    const { container } = render(<OnboardingCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the four install commands and a link to create a token when there are no machines", () => {
    useQueryMock.mockReturnValue([]);
    render(<OnboardingCard />);
    expect(screen.getByText("Install the collector")).toBeInTheDocument();
    const c = installCommands(window.location.origin);
    expect(screen.getByText("1. Install")).toBeInTheDocument();
    expect(screen.getByText(c.install)).toBeInTheDocument();
    expect(screen.getByText("2. Log in (paste your token)")).toBeInTheDocument();
    expect(screen.getByText(c.login)).toBeInTheDocument();
    expect(screen.getByText("3. Schedule background sync")).toBeInTheDocument();
    expect(screen.getByText(c.schedule)).toBeInTheDocument();
    expect(screen.getByText("4. Check")).toBeInTheDocument();
    expect(screen.getByText(c.status)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a sync token" })).toHaveAttribute("href", "/settings");
  });
});
