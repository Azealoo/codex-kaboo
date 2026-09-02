import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";

// SessionsTab issues an unguarded `usePaginatedQuery`. Keeping it throwing exercises the
// "query fails" path without needing a real Convex backend.
const usePaginatedQueryMock = vi.fn();
vi.mock("convex/react", () => ({
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}));

import { SessionsTab } from "./sessions-tab";

const userId = "user1" as Id<"users">;

describe("SessionsTab", () => {
  beforeEach(() => {
    usePaginatedQueryMock.mockReset();
    usePaginatedQueryMock.mockImplementation(() => {
      throw new Error("boom");
    });
  });

  it("shows a section-sized fallback instead of crashing when the sessions query throws", () => {
    render(<SessionsTab userId={userId} />);
    expect(screen.getByText("Sessions could not load")).toBeInTheDocument();
    expect(screen.queryByText("Load more")).not.toBeInTheDocument();
  });
});
