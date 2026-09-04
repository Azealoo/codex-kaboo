import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { SessionRow } from "@convex/lib/types";

const usePaginatedQueryMock = vi.fn();
vi.mock("convex/react", () => ({
  usePaginatedQuery: (...args: unknown[]) => usePaginatedQueryMock(...args),
}));

import { SessionsTable } from "./sessions-table";

const T = Date.UTC(2026, 8, 1, 9, 30);

function row(overrides: Partial<SessionRow> & { sessionId: string }): SessionRow {
  return {
    _id: overrides.sessionId as Id<"sessions">,
    threadId: overrides.sessionId,
    parentThreadId: null,
    userId: "u1" as Id<"users">,
    userName: "Alice",
    machineId: "m1",
    machineLabel: "brisk-otter",
    startedAt: T,
    endedAt: T + 3_600_000,
    wallMs: 3_600_000,
    day: "2026-09-01",
    timezone: "Europe/Berlin",
    project: "codex-kaboo",
    gitBranch: "main",
    originator: "codex-tui",
    cliVersion: "0.150.1",
    model: "gpt-5.6-sol",
    effort: "medium",
    source: "cli",
    isSubagent: false,
    turns: 4,
    completedTurns: 3,
    userMessages: 4,
    agentMessages: 5,
    reasoningItems: 2,
    responses: 7,
    tokens: {
      input: 1_000_000,
      cachedInput: 400_000,
      cacheWrite: 0,
      output: 20_000,
      reasoning: 5_000,
      total: 1_020_000,
    },
    cacheHitRate: 0.4,
    costUsd: 1.48,
    activeMs: 600_000,
    ttftAvgMs: 750,
    linesAdded: 120,
    linesRemoved: 30,
    filesChanged: 6,
    compactions: 1,
    toolCounts: {
      commandRead: 12,
      commandList: 0,
      commandSearch: 3,
      commandOther: 0,
      fileChange: 6,
      webSearch: 0,
      imageView: 0,
      mcpTool: 2,
      other: 0,
    },
    mcpTools: [{ key: "github/get_pr", count: 2 }],
    skills: [{ key: "dataviz", count: 1 }],
    inProgress: false,
    ...overrides,
  };
}

const rows = [
  row({ sessionId: "a" }),
  row({ sessionId: "b", project: "website", model: "gpt-5.6-luna", userName: "Bob" }),
];

describe("SessionsTable", () => {
  beforeEach(() => {
    usePaginatedQueryMock.mockReset();
    usePaginatedQueryMock.mockReturnValue({
      results: rows,
      status: "CanLoadMore",
      loadMore: vi.fn(),
    });
  });

  it("asks for the team when no user is given, and then shows who ran each session", () => {
    render(<SessionsTable />);
    expect(usePaginatedQueryMock.mock.calls[0]?.[1]).toEqual({});
    expect(screen.getByRole("columnheader", { name: "User" })).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("scopes to one user and hides the user column", () => {
    render(<SessionsTable userId={"u1" as Id<"users">} />);
    expect(usePaginatedQueryMock.mock.calls[0]?.[1]).toEqual({ userId: "u1" });
    expect(screen.queryByRole("columnheader", { name: "User" })).not.toBeInTheDocument();
  });

  it("filters the loaded rows by free text and reports the match count", async () => {
    render(<SessionsTable />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter sessions" }), "luna");
    expect(screen.getByText("website")).toBeInTheDocument();
    expect(screen.queryByText("codex-kaboo")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2 loaded sessions match.");
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter sessions" }), " nomatch");
    expect(screen.getByText("No loaded session matches “luna nomatch”")).toBeInTheDocument();
  });

  it("opens the detail dialog for a clicked row with the full breakdown", async () => {
    render(<SessionsTable userId={"u1" as Id<"users">} />);
    await userEvent.click(screen.getByRole("button", { name: /codex-kaboo, Sep 1/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Token structure")).toBeInTheDocument();
    expect(within(dialog).getByText("+120 / −30")).toBeInTheDocument();
    expect(within(dialog).getByText("3 / 4 done")).toBeInTheDocument();
    expect(within(dialog).getByText("github/get_pr")).toBeInTheDocument();
    expect(within(dialog).getByText("dataviz")).toBeInTheDocument();
    expect(within(dialog).getByText("Read files")).toBeInTheDocument();
    expect(within(dialog).getByText("Europe/Berlin")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a skeleton before the first page and an empty state with no sessions", () => {
    usePaginatedQueryMock.mockReturnValue({
      results: [],
      status: "LoadingFirstPage",
      loadMore: vi.fn(),
    });
    const { unmount } = render(<SessionsTable />);
    expect(screen.queryByText("No sessions yet")).not.toBeInTheDocument();
    unmount();
    usePaginatedQueryMock.mockReturnValue({ results: [], status: "Exhausted", loadMore: vi.fn() });
    render(<SessionsTable />);
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });
});
