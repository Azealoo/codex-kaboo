import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prices = [
  {
    _id: "p1",
    model: "model-a",
    inputUsdPerMTok: 1,
    cachedInputUsdPerMTok: 0.1,
    outputUsdPerMTok: 5,
    source: "manual",
    updatedAt: 1,
  },
  {
    _id: "p2",
    model: "model-b",
    inputUsdPerMTok: 2,
    cachedInputUsdPerMTok: 0.2,
    outputUsdPerMTok: 8,
    source: "manual",
    updatedAt: 2,
  },
];

// `upsert` is looked up once per row (`useMutation(api.prices.upsert)`), so every row shares this
// same mock function reference — exactly like the real Convex hook. What varies is the `model` in
// the call args: model-a always rejects, model-b always resolves.
const runMutation = vi.fn(async (args: { model: string; inputUsdPerMTok?: number }) => {
  if ("inputUsdPerMTok" in args) {
    if (args.model === "model-a") throw new Error("model-a save rejected");
    return "id-model-b";
  }
  return null;
});

const useQueryMock = vi.fn();
vi.mock("convex/react", () => ({
  // PricesCard issues two distinct `useQuery` calls: `api.prices.list` with `{}`, and (via
  // `useStableQuery`) `api.stats.summary` with an object carrying `previous`. Only the price list
  // matters here, so the stats query is left "loading" (undefined) and the unpriced-models banner
  // simply doesn't render.
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useMutation: () => runMutation,
}));

import { PricesCard } from "./prices-card";

describe("PricesCard", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockImplementation((_query: unknown, args: unknown) =>
      args && typeof args === "object" && "previous" in args ? undefined : prices,
    );
    runMutation.mockClear();
  });

  it("keeps one row's save error visible after a different row's save succeeds", async () => {
    render(<PricesCard />);
    const rowA = screen.getByText("model-a").closest("tr");
    const rowB = screen.getByText("model-b").closest("tr");
    if (!rowA || !rowB) throw new Error("expected both price rows to render");

    await userEvent.click(within(rowA).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("model-a save rejected")).toBeInTheDocument();

    await userEvent.click(within(rowB).getByRole("button", { name: "Save" }));
    // model-b's save resolves — model-a's still-unfixed error must remain visible, not be wiped
    // out by the sibling row's success.
    expect(screen.getByText("model-a save rejected")).toBeInTheDocument();
  });

  it("confirms before deleting an existing price", async () => {
    // `prices.remove` fired on a single click, and the button sits in the exact position and
    // styling the harmless "Cancel" occupies on the draft row above it — the easiest destructive
    // control in the app to hit by accident. Deleting a price silently re-prices every chart and
    // table to $0 for that model.
    render(<PricesCard />);
    const rowA = screen.getByText("model-a").closest("tr");
    if (!rowA) throw new Error("expected the model-a row to render");

    await userEvent.click(within(rowA).getByRole("button", { name: "Remove" }));
    expect(runMutation).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("alertdialog");
    // Named, so muscle memory cannot delete the wrong row's price.
    expect(dialog).toHaveAccessibleName(/model-a/);

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(runMutation).toHaveBeenCalledWith({ model: "model-a" });
  });

  it("lets the confirm be dismissed without deleting", async () => {
    render(<PricesCard />);
    const rowA = screen.getByText("model-a").closest("tr");
    if (!rowA) throw new Error("expected the model-a row to render");
    await userEvent.click(within(rowA).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("keeps the draft row's Cancel instant, since discarding a draft destroys nothing", async () => {
    render(<PricesCard />);
    await userEvent.click(screen.getByRole("button", { name: "Add model" }));
    const draftRow = screen.getByLabelText("Model name").closest("tr");
    if (!draftRow) throw new Error("expected the draft row to render");
    await userEvent.click(within(draftRow).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Model name")).not.toBeInTheDocument();
  });
});
