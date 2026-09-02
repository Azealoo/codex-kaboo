import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Id } from "@convex/_generated/dataModel";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renameMock = vi.fn(async () => null);
const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => renameMock,
}));
vi.mock("@/components/layout/current-user", () => ({ useCurrentUserId: () => "u1" as Id<"users"> }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => 1_756_800_000_000 }));

import { MachinesCard } from "./machines-card";

// MachinesCard issues two `useQuery` calls (`api.machines.list`, `api.users.list`); returning the
// same fixture for both is enough here — the "Owner" column falls back to an em dash when a name
// lookup misses, which this test doesn't assert on anyway.
const machine = {
  _id: "m1",
  machineId: "mach-1",
  userId: "u1",
  label: "My Laptop",
  hostname: "hidden",
  platform: "darwin",
  arch: "arm64",
  nodeVersion: "20",
  cliVersion: "1.0.0",
  codexVersion: "1.0.0",
  codexLatestVersion: "1.0.0",
  tz: null,
  firstSeenAt: 1_756_000_000_000,
  lastSyncAt: 1_756_700_000_000,
  lastRateLimit: null,
};

describe("MachinesCard rename", () => {
  beforeEach(() => {
    renameMock.mockClear();
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue([machine]);
  });

  it("disables Save and does not call the rename mutation when the label is cleared", async () => {
    render(<MachinesCard />);
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));

    const input = screen.getByLabelText("Machine label");
    await userEvent.clear(input);

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await userEvent.click(save);
    expect(renameMock).not.toHaveBeenCalled();
  });
});
