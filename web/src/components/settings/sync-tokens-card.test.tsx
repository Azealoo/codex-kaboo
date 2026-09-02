import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const create = vi.fn(async () => ({ id: "t1", token: "ck_rawsecret", prefix: "ck_raws" }));
const revoke = vi.fn(async () => null);
vi.mock("convex/react", () => ({
  useQuery: () => [
    { _id: "t0", name: "Laptop", prefix: "ck_abc123", createdAt: 1_756_700_000_000, lastUsedAt: null, revokedAt: null },
  ],
  useAction: () => create,
  useMutation: () => revoke,
}));
vi.mock("@/hooks/use-origin", () => ({ useOrigin: () => "https://kaboo.test" }));
vi.mock("@/hooks/use-now", () => ({ useNow: () => 1_756_800_000_000 }));

import { SyncTokensCard } from "./sync-tokens-card";

/** Scans every key/value actually stored, rather than trusting a stringify of the Storage object. */
function localStorageContains(substring: string): boolean {
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key === null) continue;
    if (key.includes(substring)) return true;
    const value = window.localStorage.getItem(key);
    if (value !== null && value.includes(substring)) return true;
  }
  return false;
}

describe("SyncTokensCard", () => {
  it("lists tokens by name and prefix", () => {
    render(<SyncTokensCard />);
    expect(screen.getByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText("ck_abc123…")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("creates a token and shows the raw value once with a prefilled login line", async () => {
    render(<SyncTokensCard />);
    await userEvent.click(screen.getByRole("button", { name: "New token" }));
    await userEvent.clear(screen.getByLabelText("Token name"));
    await userEvent.type(screen.getByLabelText("Token name"), "Desk PC");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(create).toHaveBeenCalledWith({ name: "Desk PC" });
    expect(await screen.findByText("ck_rawsecret")).toBeInTheDocument();
    expect(screen.getByText("codex-kaboo login --token ck_rawsecret")).toBeInTheDocument();
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });

  // Pins the token-secrecy contract: the raw value is only ever in the dialog's own React state,
  // never in localStorage/the URL, and it must not resurface once the dialog is closed and reopened.
  it("never persists the raw token anywhere once the dialog closes", async () => {
    render(<SyncTokensCard />);
    await userEvent.click(screen.getByRole("button", { name: "New token" }));
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText("ck_rawsecret")).toBeInTheDocument();

    expect(localStorageContains("ck_rawsecret")).toBe(false);
    expect(window.location.href).not.toContain("ck_rawsecret");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("ck_rawsecret")).not.toBeInTheDocument();
    expect(localStorageContains("ck_rawsecret")).toBe(false);

    // Reopening starts a fresh dialog — the previous secret must not resurface from stale state.
    await userEvent.click(screen.getByRole("button", { name: "New token" }));
    expect(screen.queryByText("ck_rawsecret")).not.toBeInTheDocument();
  });

  it("requires an explicit confirm naming the token by name and prefix before revoking", async () => {
    render(<SyncTokensCard />);
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Laptop");
    expect(dialog.textContent).toContain("ck_abc123");
    await userEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(revoke).toHaveBeenCalledWith({ tokenId: "t0" });
  });
});
